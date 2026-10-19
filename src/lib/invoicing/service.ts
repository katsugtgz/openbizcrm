import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  crmCompanies,
  crmContacts,
  invoiceItems,
  invoicePayments,
  invoices,
  journalEntries,
  journalLines,
  type Invoice,
  type InvoiceItem,
  type InvoicePayment,
} from "@/db/schema";
import { NotFoundError, OrgScopeError, requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";
import { assertSafeAmount } from "@/lib/money";
import { AccountingError } from "@/lib/accounting/engine";
import { computeLineTotals, floorTax } from "./totals";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type InvoiceStatus = Invoice["status"];

export class InvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceError";
  }
}

/** Tolak kalau periode fiskal (bulan kalender tanggal) sudah ditutup. */
async function assertPeriodOpen(
  exec: Tx | typeof db,
  orgId: string,
  dateISO: string,
): Promise<void> {
  const closed = await exec.execute(
    sql`SELECT 1 FROM fiscal_periods WHERE org_id = ${orgId} AND period_start = date_trunc('month', ${dateISO}::text::date)::date AND closed = true LIMIT 1`,
  );
  const rows =
    Array.isArray(closed) === false && "rows" in closed
      ? closed.rows
      : (closed as unknown as Record<string, unknown>[]);
  if (rows.length > 0) {
    throw new AccountingError(
      `Periode fiskal ${dateISO.slice(0, 7)} sudah ditutup.`,
    );
  }
}

/** Map kode akun -> id UUID org ini (throw kalau kode tak ada). */
export async function accountByCode(
  orgId: string,
  code: string,
  exec: Tx | typeof db = db,
): Promise<string> {
  const [row] = await exec
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.code, code)))
    .limit(1);
  if (!row) {
    throw new NotFoundError(`Akun ${code} tidak ditemukan di org ini.`);
  }
  return row.id;
}

/** Kode akun PPN keluaran (liability), auto-create per org saat dipakai. */
export const PPN_OUT_CODE = "2-2000";

/** Ambil id akun PPN keluaran; auto-create liability kalau belum ada. */
async function ppnOutAccountId(exec: Tx, orgId: string): Promise<string> {
  const [existing] = await exec
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.code, PPN_OUT_CODE)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await exec
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
  return created.id;
}

/** Nomor dokumen "INV-001" / "SLS-001" per org, max numeric suffix + 1
 * (pola nextProjectCode), diserialisasi advisory lock per org. */
export async function nextDocNumber(
  exec: Tx | typeof db,
  orgId: string,
  table: "invoices" | "pos_sales",
  column: string,
  prefix: string,
): Promise<string> {
  const prefixDash = `${prefix}-`;
  const pattern = `^${prefix}-[0-9]+$`;
  const result = await exec.execute<{ maxseq: number }>(sql`
    SELECT coalesce(max((regexp_replace(${sql.raw(column)}, ${prefixDash}, ''))::int), 0) AS maxseq
    FROM ${sql.raw(table)}
    WHERE org_id = ${orgId} AND ${sql.raw(column)} ~ ${pattern}
  `);
  const rows: { maxseq: number }[] =
    Array.isArray(result) === false && "rows" in (result as object)
      ? (result as unknown as { rows: { maxseq: number }[] }).rows
      : (result as unknown as { maxseq: number }[]);
  const next = (rows[0]?.maxseq ?? 0) + 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

async function requireInvoice(
  orgId: string,
  invoiceId: string,
  exec: Tx | typeof db = db,
): Promise<Invoice> {
  const [row] = await exec
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)))
    .limit(1)
    .for("update");
  if (!row) throw new NotFoundError("Invoice tidak ditemukan.");
  return row;
}

async function postJournal(
  exec: Tx,
  orgId: string,
  userId: string,
  input: {
    date: string;
    description: string;
    source: "invoice" | "payment";
    paymentMethod: "cash" | "transfer" | "qris";
    lines: { accountId: string; debit: number; credit: number }[];
  },
): Promise<string> {
  // Nomor jurnal max+1 di bawah advisory lock org yang SAMA dengan caller
  // (invoicing tx sudah memegang `acct:<orgId>` — wait-for reentrant aman).
  const [{ nextNum }] = await exec
    .select({
      nextNum: sql<number>`coalesce(max(${journalEntries.entryNumber}), 0) + 1`,
    })
    .from(journalEntries)
    .where(eq(journalEntries.orgId, orgId));
  const [entry] = await exec
    .insert(journalEntries)
    .values({
      orgId,
      entryNumber: nextNum,
      date: input.date,
      description: input.description,
      status: "posted",
      source: input.source,
      paymentMethod: input.paymentMethod,
      postedAt: new Date(),
      createdBy: userId,
    })
    .returning();
  await exec.insert(journalLines).values(
    input.lines.map((l) => ({
      orgId,
      entryId: entry.id,
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
    })),
  );
  return entry.id;
}

// ---------------- createInvoice ----------------

export interface InvoiceItemInput {
  description: string;
  qty: number;
  unitPrice: number;
}

export interface CreateInvoiceInput {
  companyId: string;
  contactId?: string | null;
  /** "YYYY-MM-DD"; default: hari ini (WIB). */
  issueDate: string;
  dueDate: string;
  taxPct?: number;
  notes?: string | null;
  items: InvoiceItemInput[];
}

/**
 * Buat invoice DRAFT. Perusahaan & kontak wajib milik org. Angka dihitung
 * murni lewat totals.ts. Draf tidak berdampak jurnal.
 */
export async function createInvoice(
  userId: string,
  orgId: string,
  input: CreateInvoiceInput,
): Promise<{ invoice: Invoice; items: InvoiceItem[] }> {
  await requireOrgRole(userId, orgId, "member");
  if (input.items.length === 0) {
    throw new InvoiceError("Invoice minimal 1 item.");
  }
  // Perusahaan & kontak org-scoped.
  const [company] = await db
    .select({ id: crmCompanies.id })
    .from(crmCompanies)
    .where(
      and(eq(crmCompanies.id, input.companyId), eq(crmCompanies.orgId, orgId)),
    )
    .limit(1);
  if (!company) throw new NotFoundError("Perusahaan tidak ditemukan.");
  if (input.contactId) {
    const [contact] = await db
      .select({ id: crmContacts.id })
      .from(crmContacts)
      .where(
        and(eq(crmContacts.id, input.contactId), eq(crmContacts.orgId, orgId)),
      )
      .limit(1);
    if (!contact) throw new NotFoundError("Kontak tidak ditemukan.");
  }
  if (input.dueDate < input.issueDate) {
    throw new InvoiceError("Jatuh tempo tidak boleh sebelum tanggal terbit.");
  }
  const taxPct = input.taxPct ?? 0;

  let subtotal = 0;
  const rows = input.items.map((item) => {
    if (!item.description.trim()) {
      throw new InvoiceError("Deskripsi item wajib diisi.");
    }
    const t = computeLineTotals(item.qty, item.unitPrice, 0); // pajak per invoice
    subtotal += t.lineTotal;
    if (subtotal > Number.MAX_SAFE_INTEGER) {
      throw new InvoiceError("Total item melebihi Number.MAX_SAFE_INTEGER.");
    }
    return { ...item, lineTotal: t.lineTotal };
  });
  const taxAmount = floorTax(subtotal, taxPct);
  const total = subtotal + taxAmount;
  if (total > Number.MAX_SAFE_INTEGER) {
    throw new InvoiceError("Total invoice melebihi Number.MAX_SAFE_INTEGER.");
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`inv:${orgId}`}))`,
    );
    const invoiceNumber = await nextDocNumber(
      tx,
      orgId,
      "invoices",
      "invoice_number",
      "INV",
    );
    const [invoice] = await tx
      .insert(invoices)
      .values({
        orgId,
        invoiceNumber,
        companyId: input.companyId,
        contactId: input.contactId ?? null,
        status: "draft",
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        taxPct,
        subtotal,
        taxAmount,
        total,
        notes: input.notes ?? null,
        createdBy: userId,
      })
      .returning();
    const itemRows = await tx
      .insert(invoiceItems)
      .values(
        rows.map((r) => ({
          orgId,
          invoiceId: invoice.id,
          description: r.description,
          qty: r.qty,
          unitPrice: r.unitPrice,
          lineTotal: r.lineTotal,
        })),
      )
      .returning();
    await recordAudit(
      {
        orgId,
        userId,
        action: "invoice.create",
        entity: "invoice",
        entityId: invoice.id,
        metadata: { invoiceNumber, total },
      },
      tx,
    );
    return { invoice, items: itemRows };
  });
}

// ---------------- sendInvoice ----------------

/** draft -> sent. Jurnal: debit AR, credit Revenue (posted langsung). */
export async function sendInvoice(
  userId: string,
  orgId: string,
  invoiceId: string,
): Promise<Invoice> {
  await requireOrgRole(userId, orgId, "member");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`acct:${orgId}`}))`,
    );
    const invoice = await requireInvoice(orgId, invoiceId, tx);
    if (invoice.status !== "draft") {
      throw new InvoiceError(
        `Hanya invoice draft bisa dikirim (status sekarang: ${invoice.status}).`,
      );
    }
    await assertPeriodOpen(tx, orgId, invoice.issueDate);
    const arId = await accountByCode(orgId, "1-1300", tx); // Piutang usaha
    const revId = await accountByCode(orgId, "4-1000", tx); // Pendapatan
    // PPN keluaran = liability, BUKAN pendapatan (cubic P1 invoicing:312):
    // debit AR gross, credit Revenue subtotal, credit PPN keluaran tax.
    const lines: { accountId: string; debit: number; credit: number }[] = [
      { accountId: arId, debit: invoice.total, credit: 0 },
      { accountId: revId, debit: 0, credit: invoice.subtotal },
    ];
    if (invoice.taxAmount > 0) {
      const ppnId = await ppnOutAccountId(tx, orgId);
      lines.push({ accountId: ppnId, debit: 0, credit: invoice.taxAmount });
    }
    const journalEntryId = await postJournal(tx, orgId, userId, {
      date: invoice.issueDate,
      description: `Invoice ${invoice.invoiceNumber}`,
      source: "invoice",
      paymentMethod: "transfer",
      lines,
    });
    // Expected-state predicate: status masih draft saat UPDATE.
    const [updated] = await tx
      .update(invoices)
      .set({ status: "sent", journalEntryId })
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.orgId, orgId),
          eq(invoices.status, "draft"),
        ),
      )
      .returning();
    if (!updated) {
      throw new InvoiceError("Status invoice berubah; kirim dibatalkan.");
    }
    await recordAudit(
      {
        orgId,
        userId,
        action: "invoice.send",
        entity: "invoice",
        entityId: invoiceId,
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          total: invoice.total,
        },
      },
      tx,
    );
    return updated;
  });
}

// ---------------- recordPayment ----------------

/**
 * Catat pembayaran. Overpayment (amount > sisa tagihan) DITOLAK.
 * Jurnal: debit Kas sesuai metode, credit AR — dalam tx yang sama.
 */
export async function recordPayment(
  userId: string,
  orgId: string,
  invoiceId: string,
  input: {
    amount: number;
    method: "cash" | "transfer" | "qris";
    paidAt: string; // "YYYY-MM-DD"
  },
): Promise<{ invoice: Invoice; payment: InvoicePayment }> {
  await requireOrgRole(userId, orgId, "member");
  assertSafeAmount(input.amount, "Jumlah pembayaran");
  if (input.amount === 0) {
    throw new InvoiceError("Pembayaran tidak boleh 0.");
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`acct:${orgId}`}))`,
    );
    const invoice = await requireInvoice(orgId, invoiceId, tx);
    if (invoice.status !== "sent" && invoice.status !== "overdue") {
      throw new InvoiceError(
        `Invoice status ${invoice.status} tidak bisa dibayar.`,
      );
    }
    const remaining = invoice.total - invoice.paidAmount;
    if (input.amount > remaining) {
      throw new InvoiceError(
        `Overpayment: jumlah ${input.amount} melebihi sisa tagihan ${remaining}.`,
      );
    }
    await assertPeriodOpen(tx, orgId, input.paidAt);
    const cashCode = input.method === "cash" ? "1-1000" : "1-1100"; // kas / bank
    const cashId = await accountByCode(orgId, cashCode, tx);
    const arId = await accountByCode(orgId, "1-1300", tx);
    const journalEntryId = await postJournal(tx, orgId, userId, {
      date: input.paidAt,
      description: `Pembayaran invoice`,
      source: "payment",
      paymentMethod: input.method,
      lines: [
        { accountId: cashId, debit: input.amount, credit: 0 },
        { accountId: arId, debit: 0, credit: input.amount },
      ],
    });
    const [payment] = await tx
      .insert(invoicePayments)
      .values({
        orgId,
        invoiceId,
        amount: input.amount,
        method: input.method,
        paidAt: input.paidAt,
        journalEntryId,
        createdBy: userId,
      })
      .returning();
    const paidAmount = invoice.paidAmount + input.amount;
    const status = paidAmount >= invoice.total ? "paid" : invoice.status;
    // Expected-state: status saat baca; berubah => tolak (basi).
    const [updated] = await tx
      .update(invoices)
      .set({ paidAmount, status, journalEntryId: invoice.journalEntryId })
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.orgId, orgId),
          eq(invoices.status, invoice.status),
          eq(invoices.paidAmount, invoice.paidAmount),
        ),
      )
      .returning();
    if (!updated) {
      throw new InvoiceError("Invoice berubah; pembayaran dibatalkan.");
    }
    await recordAudit(
      {
        orgId,
        userId,
        action: "invoice.payment",
        entity: "invoice",
        entityId: invoiceId,
        metadata: { amount: input.amount, method: input.method },
      },
      tx,
    );
    return { invoice: updated, payment };
  });
}

// ---------------- markOverdue ----------------

/** sent -> overdue (jatuh tempo lewat). Idempoten utk overdue. */
export async function markOverdue(
  userId: string,
  orgId: string,
  invoiceId: string,
): Promise<Invoice> {
  await requireOrgRole(userId, orgId, "member");
  // dueDate <= hari ini wajib (cubic P2 invoicing:446) — invoice yang belum
  // jatuh tempo tidak boleh dipaksa overdue walau statusnya sent.
  const [updated] = await db
    .update(invoices)
    .set({ status: "overdue" })
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.orgId, orgId),
        eq(invoices.status, "sent"),
        sql`${invoices.dueDate} <= CURRENT_DATE`,
      ),
    )
    .returning();
  if (!updated) {
    const invoice = await requireInvoice(orgId, invoiceId);
    if (invoice.status === "overdue") return invoice; // idempoten
    if (invoice.status === "sent") {
      throw new InvoiceError(
        `Invoice ${invoice.invoiceNumber} belum jatuh tempo (${invoice.dueDate}).`,
      );
    }
    throw new InvoiceError(
      `Hanya invoice sent bisa overdue (status: ${invoice.status}).`,
    );
  }
  await recordAudit({
    orgId,
    userId,
    action: "invoice.overdue",
    entity: "invoice",
    entityId: invoiceId,
  });
  return updated;
}

/** Batalkan invoice draft. */
export async function cancelInvoice(
  userId: string,
  orgId: string,
  invoiceId: string,
): Promise<Invoice> {
  await requireOrgRole(userId, orgId, "member");
  const [updated] = await db
    .update(invoices)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.orgId, orgId),
        eq(invoices.status, "draft"),
      ),
    )
    .returning();
  if (!updated) {
    throw new InvoiceError("Hanya invoice draft bisa dibatalkan.");
  }
  await recordAudit({
    orgId,
    userId,
    action: "invoice.cancel",
    entity: "invoice",
    entityId: invoiceId,
  });
  return updated;
}

// ---------------- Queries ----------------

/** Daftar faktur terbaru; dibatasi 100 (cubic pr8 faktur/page:54). */
export async function listInvoices(
  orgId: string,
  limit = 100,
): Promise<Invoice[]> {
  return db
    .select()
    .from(invoices)
    .where(eq(invoices.orgId, orgId))
    .orderBy(desc(invoices.createdAt))
    .limit(limit);
}

export async function getInvoice(
  orgId: string,
  invoiceId: string,
): Promise<{ invoice: Invoice; items: InvoiceItem[] } | null> {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)))
    .limit(1);
  if (!invoice) return null;
  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId))
    .orderBy(asc(invoiceItems.id));
  return { invoice, items };
}

export async function listInvoicePayments(
  orgId: string,
  invoiceId: string,
): Promise<InvoicePayment[]> {
  return db
    .select()
    .from(invoicePayments)
    .where(
      and(
        eq(invoicePayments.orgId, orgId),
        eq(invoicePayments.invoiceId, invoiceId),
      ),
    )
    .orderBy(asc(invoicePayments.createdAt));
}

void OrgScopeError;
