import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { organizations, products, users } from "@/db/schema";

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("pos integration", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let pos!: typeof import("@/lib/pos/service");
  let acct!: typeof import("@/lib/accounting/service");

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    pos = await import("@/lib/pos/service");
    acct = await import("@/lib/accounting/service");
  });

  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    for (const id of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
    }
    for (const id of createdUserIds) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  async function makeOrg(): Promise<{ userId: string; orgId: string }> {
    const owner = await (
      await import("@/lib/repos/user-repo")
    ).createUser({
      workosUserId: `it-pos-${suffix}-${createdUserIds.length}`,
      email: `it-pos-${suffix}-${createdUserIds.length}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await (
      await import("@/lib/repos/org-repo")
    ).createOrg(
      {
        name: `POS Org ${suffix}`,
        slug: `it-pos-${suffix}-${createdOrgIds.length}`,
      },
      owner.id,
    );
    createdOrgIds.push(org.id);
    return { userId: owner.id, orgId: org.id };
  }

  async function seedPosAccounts(o: { userId: string; orgId: string }) {
    await acct.createAccount(o.userId, o.orgId, {
      code: "1-1000",
      name: "Kas",
      type: "asset",
    });
    await acct.createAccount(o.userId, o.orgId, {
      code: "1-1100",
      name: "Bank",
      type: "asset",
    });
    await acct.createAccount(o.userId, o.orgId, {
      code: "4-1000",
      name: "Pendapatan",
      type: "revenue",
    });
  }

  itDb(
    "checkout TX: stock check, journal, race sequential double-buy, isolation",
    async () => {
      const o = await makeOrg();
      await seedPosAccounts(o);
      const product = await pos.addProduct(o.userId, o.orgId, {
        name: `Kopi ${suffix}`,
        sku: `KPI-${suffix}`,
        price: 25_000,
        initialStock: 3,
      });

      // stok kurang => throw, tidak ada mutasi
      await expect(
        pos.checkout(o.userId, o.orgId, {
          items: [{ productId: product.id, qty: 5 }],
          paymentMethod: "cash",
          date: "2026-11-01",
        }),
      ).rejects.toThrow(/Stok tidak cukup/);
      const [unchanged] = await db
        .select()
        .from(products)
        .where(eq(products.id, product.id));
      expect(unchanged.stockQty).toBe(3);

      // checkout 2: stok 3 -> 1, jurnal 50_000 kas/revenue
      const r1 = await pos.checkout(o.userId, o.orgId, {
        items: [{ productId: product.id, qty: 2 }],
        paymentMethod: "cash",
        date: "2026-11-01",
        taxPct: 11,
      });
      expect(r1.sale.saleNumber).toBe("SLS-001");
      expect(r1.sale.subtotal).toBe(50_000);
      expect(r1.sale.taxAmount).toBe(5_500);
      expect(r1.sale.total).toBe(55_500);
      const [p1] = await db
        .select()
        .from(products)
        .where(eq(products.id, product.id));
      expect(p1.stockQty).toBe(1);

      // race: dua checkout KONKUREN memperebutkan stok tersisa 1 —
      // sequential tidak bisa mendeteksi lost-update (cubic pr8 pos-test:116).
      const [ok, lost] = await Promise.allSettled([
        pos.checkout(o.userId, o.orgId, {
          items: [{ productId: product.id, qty: 1 }],
          paymentMethod: "qris",
          date: "2026-11-02",
        }),
        pos.checkout(o.userId, o.orgId, {
          items: [{ productId: product.id, qty: 1 }],
          paymentMethod: "cash",
          date: "2026-11-03",
        }),
      ]);
      expect(ok.status).toBe("fulfilled");
      expect(lost.status).toBe("rejected");
      expect(lost.status === "rejected" ? String(lost.reason) : "").toMatch(
        /Stok tidak cukup/,
      );
      const [pRace] = await db
        .select()
        .from(products)
        .where(eq(products.id, product.id));
      expect(pRace.stockQty).toBe(0);

      // produk org lain tidak terlihat
      const o2 = await makeOrg();
      await seedPosAccounts(o2);
      const productB = await pos.addProduct(o2.userId, o2.orgId, {
        name: `Teh ${suffix}`,
        sku: `TEH-${suffix}`,
        price: 5_000,
        initialStock: 10,
      });
      await expect(
        pos.checkout(o2.userId, o2.orgId, {
          items: [{ productId: product.id, qty: 1 }], // produk org A
          paymentMethod: "cash",
          date: "2026-11-01",
        }),
      ).rejects.toThrow(/tidak ditemukan/);

      // stok org B tak tersentuh; nomor struk org B mulai 1
      const saleB = await pos.checkout(o2.userId, o2.orgId, {
        items: [{ productId: productB.id, qty: 1 }],
        paymentMethod: "transfer",
        date: "2026-11-01",
      });
      expect(saleB.sale.saleNumber).toBe("SLS-001");
      const [pB] = await db
        .select()
        .from(products)
        .where(eq(products.id, productB.id));
      expect(pB.stockQty).toBe(9);

      // jurnal balanced: org A total debit = 55_500 + 25_000
      const tbA = await acct.trialBalanceService(o.orgId);
      expect(tbA.balanced).toBe(true);
      expect(tbA.totalDebit).toBe(80_500);
      const tbB = await acct.trialBalanceService(o2.orgId);
      expect(tbB.totalDebit).toBe(5_000);
      // Unbalanced transfer entry tidak boleh lolos test ini (cubic pr8 pos-test:167).
      expect(tbB.balanced).toBe(true);

      // recentSales
      const recent = await pos.recentSales(o.orgId);
      expect(recent).toHaveLength(2);
      expect(recent[0].items.length).toBeGreaterThan(0);
    },
  );

  itDb("restock menambah stok; qty <= 0 ditolak", async () => {
    const o = await makeOrg();
    await seedPosAccounts(o);
    const product = await pos.addProduct(o.userId, o.orgId, {
      name: `Gula ${suffix}`,
      sku: `GUL-${suffix}`,
      price: 15_000,
      initialStock: 2,
    });
    const after = await pos.restock(o.userId, o.orgId, product.id, 10);
    expect(after.stockQty).toBe(12);
    await expect(
      pos.restock(o.userId, o.orgId, product.id, 0),
    ).rejects.toThrow();
    await expect(
      pos.restock(o.userId, o.orgId, product.id, -3),
    ).rejects.toThrow();
  });

  // cubic P1 pos:252: checkout posting langsung "posted" tanpa cek
  // fiscal_periods — bulan yang sudah ditutup harus ditolak seperti
  // accounting/invoicing.
  itDb(
    "checkout ditolak saat periode fiskal bulan tanggal sudah ditutup",
    async () => {
      const o = await makeOrg();
      await seedPosAccounts(o);
      const product = await pos.addProduct(o.userId, o.orgId, {
        name: `Garam ${suffix}`,
        sku: `GRM-${suffix}`,
        price: 5_000,
        initialStock: 5,
      });
      await acct.closePeriod(o.userId, o.orgId, "2026-11");
      await expect(
        pos.checkout(o.userId, o.orgId, {
          items: [{ productId: product.id, qty: 1 }],
          paymentMethod: "cash",
          date: "2026-11-01",
        }),
      ).rejects.toThrow(/ditutup/);
      // Stok tak terpotong (rollback penuh).
      const [p] = await db
        .select()
        .from(products)
        .where(eq(products.id, product.id));
      expect(p.stockQty).toBe(5);
    },
  );

  // cubic P1 (padanan invoicing:312 di POS): PPN bukan pendapatan — jurnal
  // checkout ber-PPN credit Revenue subtotal, credit PPN keluaran taxAmount.
  itDb(
    "checkout berpajak: revenue subtotal, PPN keluaran terpisah",
    async () => {
      const o = await makeOrg();
      await seedPosAccounts(o);
      const product = await pos.addProduct(o.userId, o.orgId, {
        name: `Teh PPN ${suffix}`,
        sku: `TPP-${suffix}`,
        price: 10_000,
        initialStock: 5,
      });
      const r = await pos.checkout(o.userId, o.orgId, {
        items: [{ productId: product.id, qty: 2 }],
        paymentMethod: "cash",
        date: "2026-11-01",
        taxPct: 11,
      });
      expect(r.sale.total).toBe(22_200);
      const { journalEntries, journalLines, accounts } =
        await import("@/db/schema");
      const [entry] = await db
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.id, r.sale.journalEntryId!));
      expect(entry).toBeDefined();
      const lines = await db
        .select({ line: journalLines, account: accounts })
        .from(journalLines)
        .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
        .where(eq(journalLines.entryId, entry.id));
      const rev = lines.find((l) => l.account.code === "4-1000");
      const ppn = lines.find((l) => l.account.code === "2-2000");
      expect(rev?.line.credit).toBe(20_000); // subtotal
      expect(ppn?.line.credit).toBe(2_200); // taxAmount
      expect(ppn?.account.type).toBe("liability");
    },
  );

  // cubic pr8 schema:761 — stockQty berubah wajib menulis inventory_movements
  // di transaksi yang sama (kartu stok tidak boleh kosong).
  itDb("restock + checkout mencatat inventoryMovements", async () => {
    const { inventoryMovements, products, posSales } =
      await import("@/db/schema");
    const o = await makeOrg();
    // Checkout butuh COA kas & pendapatan di org ini.
    await acct.createAccount(o.userId, o.orgId, {
      code: "1-1000",
      name: "Kas",
      type: "asset",
    });
    await acct.createAccount(o.userId, o.orgId, {
      code: "4-1000",
      name: "Penjualan",
      type: "revenue",
    });
    const [product] = await db
      .insert(products)
      .values({
        orgId: o.orgId,
        name: "Produk Kartu",
        sku: `SKU-K-${Date.now()}`,
        price: 10_000,
        stockQty: 5,
      })
      .returning();
    await pos.restock(o.userId, o.orgId, product.id, 3);
    const afterRestock = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.productId, product.id));
    expect(afterRestock).toHaveLength(1);
    expect(afterRestock[0].qtyDelta).toBe(3);
    expect(afterRestock[0].reason).toBe("restock");
    await pos.checkout(o.userId, o.orgId, {
      date: "2026-10-20",
      paymentMethod: "cash",
      items: [{ productId: product.id, qty: 2 }],
    });
    const afterSale = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.productId, product.id));
    expect(afterSale).toHaveLength(2);
    expect(afterSale[1].qtyDelta).toBe(-2);
    expect(afterSale[1].reason).toBe("sale");
    void posSales;
  });
});
