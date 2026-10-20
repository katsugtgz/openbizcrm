import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  inventoryMovements,
  journalEntries,
  journalLines,
  posSaleItems,
  posSales,
  products,
  type PosSale,
  type PosSaleItem,
  type Product,
} from "@/db/schema";
import { NotFoundError, requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";
import { assertSafeAmount } from "@/lib/money";
import { AccountingError, assertISODate } from "@/lib/accounting/engine";
import { computeLineTotals, floorTax } from "@/lib/invoicing/totals";
import { PPN_OUT_CODE } from "@/lib/invoicing/service";

export class PosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PosError";
  }
}

export interface AddProductInput {
  name: string;
  sku: string;
  price: number;
  initialStock?: number;
}

export async function addProduct(
  userId: string,
  orgId: string,
  input: AddProductInput,
): Promise<Product> {
  await requireOrgRole(userId, orgId, "member");
  if (!input.name.trim() || !input.sku.trim()) {
    throw new PosError("Nama dan SKU produk wajib diisi.");
  }
  assertSafeAmount(input.price, "Harga jual");
  const initialStock = input.initialStock ?? 0;
  if (!Number.isInteger(initialStock) || initialStock < 0) {
    throw new PosError("Stok awal harus integer >= 0.");
  }
  const [row] = await db
    .insert(products)
    .values({
      orgId,
      name: input.name,
      sku: input.sku,
      price: input.price,
      stockQty: initialStock,
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "pos.product.create",
    entity: "product",
    entityId: row.id,
    metadata: { sku: row.sku, price: row.price, stock: row.stockQty },
  });
  return row;
}

export async function listProducts(orgId: string): Promise<Product[]> {
  return db
    .select()
    .from(products)
    .where(eq(products.orgId, orgId))
    .orderBy(desc(products.createdAt));
}

/** Restock: stok += qty (kartu mutasi POS-in tanpa jurnal pembelian). */
export async function restock(
  userId: string,
  orgId: string,
  productId: string,
  qty: number,
): Promise<Product> {
  await requireOrgRole(userId, orgId, "member");
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new PosError("Jumlah restock harus integer > 0.");
  }
  // Expected-state: stock saat baca; berubah => tolak (race kecil, cukup).
  // Kartu stok wajib: mutasi restock dicatat di transaksi yang sama dengan
  // perubahan stockQty (cubic pr8 schema:761).
  const updated = await db.transaction(async (tx) => {
    const [product] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.orgId, orgId)))
      .limit(1)
      .for("update");
    if (!product) throw new NotFoundError("Produk tidak ditemukan.");
    const [updated] = await tx
      .update(products)
      .set({ stockQty: product.stockQty + qty })
      .where(eq(products.id, productId))
      .returning();
    await tx.insert(inventoryMovements).values({
      orgId,
      productId,
      qtyDelta: qty,
      reason: "restock",
    });
    await recordAudit(
      {
        orgId,
        userId,
        action: "pos.restock",
        entity: "product",
        entityId: productId,
        metadata: { qty },
      },
      tx,
    );
    // cubic r3 pos:93 — kembalikan hasil dalam tx; post-commit re-read
    // bisa menampilkan stock operasi concurrent lain.
    return updated;
  });
  return updated;
}

export interface CheckoutItemInput {
  productId: string;
  qty: number;
}

export interface CheckoutInput {
  items: CheckoutItemInput[];
  paymentMethod: "cash" | "transfer" | "qris";
  taxPct?: number;
  /** "YYYY-MM-DD"; default: hard-required agar jurnal eksplisit. */
  date: string;
}

export interface CheckoutResult {
  sale: PosSale;
  items: PosSaleItem[];
}

/**
 * Checkout POS — SATU transaksi: cek stok (insufficient => throw), potong
 * stok, tulis pos_sales + items, posting jurnal cash/AR debit vs revenue
 * credit. Semua atomik; lock baris produk FOR UPDATE (race double-buy).
 */
export async function checkout(
  userId: string,
  orgId: string,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  await requireOrgRole(userId, orgId, "member");
  if (input.items.length === 0) {
    throw new PosError("Checkout minimal 1 item.");
  }
  if (!["cash", "transfer", "qris"].includes(input.paymentMethod)) {
    throw new PosError("Metode pembayaran tidak valid.");
  }
  assertISODate(input.date, "Tanggal");
  // Dedupe produk: qty kumulatif per produk.
  const qtyByProduct = new Map<string, number>();
  for (const item of input.items) {
    if (!Number.isInteger(item.qty) || item.qty <= 0) {
      throw new PosError("Jumlah (qty) harus integer > 0.");
    }
    qtyByProduct.set(
      item.productId,
      (qtyByProduct.get(item.productId) ?? 0) + item.qty,
    );
  }
  const taxPct = input.taxPct ?? 0;

  return db.transaction(async (tx) => {
    // Satu lock family dengan accounting + invoicing (cubic P1 invoicing:294
    // dan P2 pos:164): checkout menulis journal_entries.entryNumber, jadi
    // alokasi nomor jurnal wajib serialized dengan semua penulis jurnal lain.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`acct:${orgId}`}))`,
    );

    // Baca + lock produk; insufficient stock => throw (rollback semua).
    const productRows: Product[] = [];
    let subtotal = 0;
    const itemValues: {
      productId: string;
      productName: string;
      qty: number;
      unitPrice: number;
      lineTotal: number;
    }[] = [];
    for (const [productId, qty] of qtyByProduct) {
      const [product] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, productId), eq(products.orgId, orgId)))
        .limit(1)
        .for("update");
      if (!product) throw new NotFoundError("Produk tidak ditemukan.");
      if (product.stockQty < qty) {
        throw new PosError(
          `Stok tidak cukup: ${product.name} sisa ${product.stockQty}, diminta ${qty}.`,
        );
      }
      const line = computeLineTotals(qty, product.price, 0);
      subtotal += line.lineTotal;
      if (subtotal > Number.MAX_SAFE_INTEGER) {
        throw new PosError("Subtotal melebihi Number.MAX_SAFE_INTEGER.");
      }
      productRows.push(product);
      itemValues.push({
        productId,
        productName: product.name,
        qty,
        unitPrice: product.price,
        lineTotal: line.lineTotal,
      });
    }
    const taxAmount = floorTax(subtotal, taxPct);
    const total = subtotal + taxAmount;
    if (total > Number.MAX_SAFE_INTEGER) {
      throw new PosError("Total melebihi Number.MAX_SAFE_INTEGER.");
    }

    // Nomor struk max+1 (advisory lock org sudah dipegang).
    const numResult = await tx.execute<{ maxseq: number }>(sql`
      SELECT coalesce(max((regexp_replace(sale_number, '^SLS-', ''))::int), 0) AS maxseq
      FROM pos_sales
      WHERE org_id = ${orgId} AND sale_number ~ '^SLS-[0-9]+$'
    `);
    const numRows: { maxseq: number }[] =
      Array.isArray(numResult) === false && "rows" in (numResult as object)
        ? (numResult as unknown as { rows: { maxseq: number }[] }).rows
        : (numResult as unknown as { maxseq: number }[]);
    const saleNumber = `SLS-${String((numRows[0]?.maxseq ?? 0) + 1).padStart(3, "0")}`;

    // Periode fiskal bulan tanggal jurnal harus terbuka (cubic P1 pos:252)
    // — assert dalam tx yang sama, sama dengan accounting/invoicing.
    const closed = await tx.execute(
      sql`SELECT 1 FROM fiscal_periods WHERE org_id = ${orgId} AND period_start = date_trunc('month', ${input.date}::text::date)::date AND closed = true LIMIT 1`,
    );
    const closedRows =
      Array.isArray(closed) === false && "rows" in closed
        ? closed.rows
        : (closed as unknown as Record<string, unknown>[]);
    if (closedRows.length > 0) {
      throw new AccountingError(
        `Periode fiskal ${input.date.slice(0, 7)} sudah ditutup.`,
      );
    }

    // Jurnal: debit kas/bank gross, credit Revenue subtotal, credit PPN
    // keluaran taxAmount (PPN bukan pendapatan — cubic P1 invoicing:312).
    const cashCode = input.paymentMethod === "cash" ? "1-1000" : "1-1100";
    const [cashAccount] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.orgId, orgId), eq(accounts.code, cashCode)))
      .limit(1);
    const [revenueAccount] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.orgId, orgId), eq(accounts.code, "4-1000")))
      .limit(1);
    if (!cashAccount || !revenueAccount) {
      throw new NotFoundError(
        `Akun ${!cashAccount ? cashCode : "4-1000"} tidak ditemukan di org ini.`,
      );
    }
    // Total 0 (item gratis): tanpa jurnal — baris (0,0) melanggar CHECK
    // journal_lines_amounts_check. Stok tetap dipotong + audit tetap dicatat.
    let journalEntryId: string | null = null;
    if (total > 0) {
      const [{ nextNum }] = await tx
        .select({
          nextNum: sql<number>`coalesce(max(${journalEntries.entryNumber}), 0) + 1`,
        })
        .from(journalEntries)
        .where(eq(journalEntries.orgId, orgId));
      const [entry] = await tx
        .insert(journalEntries)
        .values({
          orgId,
          entryNumber: nextNum,
          date: input.date,
          description: `Penjualan POS ${saleNumber}`,
          status: "posted",
          source: "pos",
          paymentMethod: input.paymentMethod,
          postedAt: new Date(),
          createdBy: userId,
        })
        .returning();
      const posJournalLines: {
        orgId: string;
        entryId: string;
        accountId: string;
        debit: number;
        credit: number;
      }[] = [
        {
          orgId,
          entryId: entry.id,
          accountId: cashAccount.id,
          debit: total,
          credit: 0,
        },
        {
          orgId,
          entryId: entry.id,
          accountId: revenueAccount.id,
          debit: 0,
          credit: subtotal,
        },
      ];
      if (taxAmount > 0) {
        let [ppnAccount] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.orgId, orgId), eq(accounts.code, PPN_OUT_CODE)))
          .limit(1);
        if (!ppnAccount) {
          // Auto-create akun PPN keluaran (liability) per org, seperti invoicing.
          [ppnAccount] = await tx
            .insert(accounts)
            .values({
              orgId,
              code: PPN_OUT_CODE,
              name: "PPN Keluaran",
              type: "liability",
            })
            .onConflictDoUpdate({
              target: [accounts.orgId, accounts.code],
              set: { name: "PPN Keluaran" },
            })
            .returning();
        }
        posJournalLines.push({
          orgId,
          entryId: entry.id,
          accountId: ppnAccount.id,
          debit: 0,
          credit: taxAmount,
        });
      }
      await tx.insert(journalLines).values(posJournalLines);
      journalEntryId = entry.id;
    }

    const [sale] = await tx
      .insert(posSales)
      .values({
        orgId,
        saleNumber,
        userId,
        paymentMethod: input.paymentMethod,
        taxPct,
        subtotal,
        taxAmount,
        total,
        journalEntryId,
        // createdAt milik DB (defaultNow = waktu server): tanggal input
        // kasir tak boleh memalsukan stempel audit. Tanggal bisnis tetap
        // tercatat di jurnal (input.date).
      })
      .returning();
    const itemRows = await tx
      .insert(posSaleItems)
      .values(
        itemValues.map((v) => ({
          orgId,
          saleId: sale.id,
          ...v,
        })),
      )
      .returning();

    // Potong stok (produk masih terkunci FOR UPDATE) + kartu mutasi
    // `sale` di transaksi yang sama (cubic pr8 schema:761).
    for (const [productId, qty] of qtyByProduct) {
      await tx
        .update(products)
        .set({ stockQty: sql`${products.stockQty} - ${qty}` })
        .where(and(eq(products.id, productId), eq(products.orgId, orgId)));
      await tx.insert(inventoryMovements).values({
        orgId,
        productId,
        qtyDelta: -qty,
        reason: "sale",
      });
    }

    await recordAudit(
      {
        orgId,
        userId,
        action: "pos.checkout",
        entity: "pos_sale",
        entityId: sale.id,
        metadata: { saleNumber, total, items: itemValues.length },
      },
      tx,
    );
    return { sale, items: itemRows };
  });
}

export interface RecentSaleRow {
  sale: PosSale;
  items: PosSaleItem[];
}

/** Penjualan terakhir (default 20) — header + items. */
export async function recentSales(
  orgId: string,
  limit = 20,
): Promise<RecentSaleRow[]> {
  const sales = await db
    .select()
    .from(posSales)
    .where(eq(posSales.orgId, orgId))
    .orderBy(desc(posSales.createdAt))
    .limit(limit);
  if (sales.length === 0) return [];
  const items = await db
    .select()
    .from(posSaleItems)
    .where(
      and(
        eq(posSaleItems.orgId, orgId),
        sql`${posSaleItems.saleId} IN (${sql.join(
          sales.map((s) => sql`${s.id}`),
          sql`, `,
        )})`,
      ),
    );
  return sales.map((sale) => ({
    sale,
    items: items.filter((i) => i.saleId === sale.id),
  }));
}
