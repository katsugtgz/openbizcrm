import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  journalEntries,
  journalLines,
  type Account,
  type JournalEntry,
  type JournalLine,
} from "@/db/schema";
import { NotFoundError, requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";
import {
  AccountingError,
  accountBalance,
  trialBalance,
  validateEntry,
  type AccountType,
  type JournalLineInput,
  type TrialBalance,
} from "./engine";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AccountRow = Account;

// ---------------- Accounts ----------------

export async function createAccount(
  userId: string,
  orgId: string,
  input: {
    code: string;
    name: string;
    type: AccountType;
    parentId?: string | null;
  },
): Promise<Account> {
  await requireOrgRole(userId, orgId, "member");
  if (!input.code.trim() || !input.name.trim()) {
    throw new AccountingError("Kode dan nama akun wajib diisi.");
  }
  if (input.parentId) {
    const [parent] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, input.parentId), eq(accounts.orgId, orgId)))
      .limit(1);
    if (!parent) throw new NotFoundError("Akun induk tidak ditemukan.");
  }
  const [row] = await db
    .insert(accounts)
    .values({
      orgId,
      code: input.code,
      name: input.name,
      type: input.type,
      parentId: input.parentId ?? null,
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "accounting.account.create",
    entity: "account",
    entityId: row.id,
    metadata: { code: row.code, type: row.type },
  });
  return row;
}

export async function listAccounts(orgId: string): Promise<Account[]> {
  return db
    .select()
    .from(accounts)
    .where(eq(accounts.orgId, orgId))
    .orderBy(asc(accounts.code));
}

/** Bentuk pohon chart of accounts dari daftar datar (parent first). */
export function accountTree(rows: Account[]): (Account & {
  children: Account[];
})[] {
  const byId = new Map<string, Account & { children: Account[] }>();
  for (const r of rows) byId.set(r.id, { ...r, children: [] });
  const roots: (Account & { children: Account[] })[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

async function requireAccount(
  orgId: string,
  accountId: string,
  exec: Tx | typeof db = db,
): Promise<Account> {
  const [row] = await exec
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.orgId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError("Akun tidak ditemukan.");
  return row;
}

// ---------------- Journal entries ----------------

export interface CreateEntryInput {
  date: string; // "YYYY-MM-DD"
  description?: string | null;
  source?:
    "manual" | "invoice" | "payment" | "pos" | "payroll" | "depreciation";
  paymentMethod?: "cash" | "transfer" | "qris" | null;
  lines: { accountId: string; debit: number; credit: number }[];
}

/**
 * Buat entri jurnal DRAFT. Validasi engine (seimbang, satu sisi, integer
 * aman) + semua akun milik org. Belum berdampak pada saldo posted.
 */
export async function createJournalEntry(
  userId: string,
  orgId: string,
  input: CreateEntryInput,
): Promise<{ entry: JournalEntry; lines: JournalLine[] }> {
  await requireOrgRole(userId, orgId, "member");
  const accountRows = await Promise.all(
    input.lines.map((l) => requireAccount(orgId, l.accountId)),
  );
  const lineInputs: JournalLineInput[] = input.lines.map((l, i) => ({
    accountCode: accountRows[i].code,
    debit: l.debit,
    credit: l.credit,
  }));
  const errors = validateEntry(lineInputs);
  if (errors.length > 0) {
    throw new AccountingError(errors.join(" "));
  }
  return db.transaction(async (tx) => {
    // Nomor jurnal dialokasikan saat draft: unique (org, entry_number) tidak
    // membolehkan placeholder duplikat, dan advisory lock per org menjamin
    // max+1 dua draft konkuren tidak bentrok.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`acct:${orgId}`}))`,
    );
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
        description: input.description ?? null,
        status: "draft",
        source: input.source ?? "manual",
        paymentMethod: input.paymentMethod ?? null,
        createdBy: userId,
      })
      .returning();
    const lineRows = await tx
      .insert(journalLines)
      .values(
        input.lines.map((l) => ({
          orgId,
          entryId: entry.id,
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
        })),
      )
      .returning();
    await recordAudit(
      {
        orgId,
        userId,
        action: "accounting.entry.create",
        entity: "journal_entry",
        entityId: entry.id,
        metadata: { date: input.date, lines: input.lines.length },
      },
      tx,
    );
    return { entry, lines: lineRows };
  });
}

/**
 * Posting: draft -> posted. Advisory lock per org (hashtext "acct:<orgId>")
 * men-serialisasi penomoran; entryNumber = max+1 di dalam transaksi; tolak
 * kalau periode fiskal (bulan kalender tanggal entri) sudah ditutup.
 * Re-validasi engine sebelum menulis.
 */
export async function postEntry(
  userId: string,
  orgId: string,
  entryId: string,
): Promise<JournalEntry> {
  await requireOrgRole(userId, orgId, "member");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`acct:${orgId}`}))`,
    );
    const [entry] = await tx
      .select()
      .from(journalEntries)
      .where(
        and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId)),
      )
      .limit(1)
      .for("update");
    if (!entry) throw new NotFoundError("Entri jurnal tidak ditemukan.");
    if (entry.status === "posted") return entry; // idempoten

    const lines = await tx
      .select()
      .from(journalLines)
      .where(
        and(eq(journalLines.entryId, entryId), eq(journalLines.orgId, orgId)),
      );
    const accountRows = await Promise.all(
      lines.map((l) => requireAccount(orgId, l.accountId, tx)),
    );
    const errors = validateEntry(
      lines.map((l, i) => ({
        accountCode: accountRows[i].code,
        debit: l.debit,
        credit: l.credit,
      })),
    );
    if (errors.length > 0) throw new AccountingError(errors.join(" "));

    // Periode fiskal = kalender bulan tanggal entri; ditutup => tolak.
    const closed = await tx.execute(
      sql`SELECT 1 FROM fiscal_periods WHERE org_id = ${orgId} AND period_start = date_trunc('month', (${entry.date}::text)::date)::date AND closed = true LIMIT 1`,
    );
    const closedRows =
      Array.isArray(closed) === false && "rows" in closed
        ? closed.rows
        : (closed as unknown as Record<string, unknown>[]);
    if (closedRows.length > 0) {
      throw new AccountingError(
        `Periode fiskal ${entry.date.slice(0, 7)} sudah ditutup; entri tidak bisa diposting.`,
      );
    }

    // Nomor sudah dialokasikan saat draft (createJournalEntry); posting
    // hanya mengubah status — tidak menaikkan nomor lagi.
    const [updated] = await tx
      .update(journalEntries)
      .set({ status: "posted", postedAt: new Date() })
      .where(
        and(
          eq(journalEntries.id, entryId),
          eq(journalEntries.orgId, orgId),
          // Expected-state: draft saja — posting konkuren atas entry yang
          // sudah posted tidak menaikkan nomor dua kali.
          eq(journalEntries.status, "draft"),
        ),
      )
      .returning();
    if (!updated) {
      const [fresh] = await tx
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.id, entryId))
        .limit(1);
      throw new AccountingError(
        `Posting basi: entri sudah ${fresh?.status ?? "hilang"}.`,
      );
    }
    await recordAudit(
      {
        orgId,
        userId,
        action: "accounting.entry.post",
        entity: "journal_entry",
        entityId: entryId,
        metadata: { entryNumber: entry.entryNumber },
      },
      tx,
    );
    return updated;
  });
}

/** Buku besar: baris posted satu akun, saldo berjalan. */
export interface LedgerRow {
  line: JournalLine;
  entry: JournalEntry;
  runningBalance: number;
}

export async function listLedger(
  orgId: string,
  accountId: string,
): Promise<LedgerRow[]> {
  const account = await requireAccount(orgId, accountId);
  const rows = await db
    .select({ line: journalLines, entry: journalEntries })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.orgId, orgId),
        eq(journalLines.accountId, accountId),
        eq(journalEntries.status, "posted"),
      ),
    )
    .orderBy(asc(journalEntries.date), asc(journalEntries.entryNumber));
  let running = 0;
  return rows.map((r) => {
    running += accountBalance(
      [
        {
          accountCode: account.code,
          debit: r.line.debit,
          credit: r.line.credit,
        },
      ],
      account.type,
    );
    return { ...r, runningBalance: running };
  });
}

/** Neraca saldo posted seluruh org. */
export async function trialBalanceService(
  orgId: string,
  period?: string, // "YYYY-MM" — batasi jurnal posted pada bulan kalender tsb
): Promise<TrialBalance & { accountById: Map<string, Account> }> {
  // cubic r3: periode tak-valid -> error jelas, bukan laporan kosong diam
  if (period !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new NotFoundError("Periode harus format YYYY-MM (bulan 01-12).");
  }
  const accountRows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.orgId, orgId));
  const rows = await db
    .select({ line: journalLines })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.orgId, orgId),
        eq(journalEntries.status, "posted"),
        period
          ? sql`to_char(${journalEntries.date}::text::date, 'YYYY-MM') = ${period}`
          : undefined,
      ),
    );
  const types: Record<string, AccountType> = {};
  const accountById = new Map<string, Account>();
  for (const a of accountRows) {
    types[a.code] = a.type;
    accountById.set(a.id, a);
  }
  const entries = rows.map((r) => {
    const a = accountById.get(r.line.accountId)!;
    return {
      accountCode: a.code,
      debit: r.line.debit,
      credit: r.line.credit,
    };
  });
  return { ...trialBalance([entries], types), accountById };
}

// ---------------- Close period ----------------

/** Tutup periode fiskal (kalender bulan). Admin saja. */
export async function closePeriod(
  userId: string,
  orgId: string,
  yearMonth: string, // "YYYY-MM"
): Promise<void> {
  await requireOrgRole(userId, orgId, "admin");
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new AccountingError("Format periode harus YYYY-MM.");
  }
  const month = Number(yearMonth.slice(5));
  if (month < 1 || month > 12) {
    throw new AccountingError(
      `Bulan periode tidak valid: ${yearMonth} (01-12).`,
    );
  }
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`acct:${orgId}`}))`,
    );
    await tx.execute(sql`
      INSERT INTO fiscal_periods (org_id, period_start, closed)
      VALUES (${orgId}, (${yearMonth} || '-01')::date, true)
      ON CONFLICT (org_id, period_start) DO UPDATE SET closed = true
    `);
    await recordAudit(
      {
        orgId,
        userId,
        action: "accounting.period.close",
        entity: "fiscal_period",
        entityId: yearMonth,
      },
      tx,
    );
  });
}

// ---------------- Laporan ----------------

export interface IncomeStatement {
  revenue: { account: Account; balance: number }[];
  expense: { account: Account; balance: number }[];
  netIncome: number;
}

export async function incomeStatement(
  orgId: string,
  period?: string, // "YYYY-MM"
): Promise<IncomeStatement> {
  const tb = await trialBalanceService(orgId, period);
  return incomeStatementFromTb(tb);
}

/** Laporan laba rugi dari trial balance yang sudah diambil (satu snapshot). */
function incomeStatementFromTb(
  tb: Awaited<ReturnType<typeof trialBalanceService>>,
): IncomeStatement {
  const revenue: IncomeStatement["revenue"] = [];
  const expense: IncomeStatement["expense"] = [];
  for (const line of tb.lines) {
    const account = tb.accountById.get(
      [...tb.accountById.values()].find((a) => a.code === line.accountCode)
        ?.id ?? "",
    );
    if (!account) continue;
    if (account.type === "revenue")
      revenue.push({ account, balance: line.balance });
    if (account.type === "expense")
      expense.push({ account, balance: line.balance });
  }
  const netIncome =
    revenue.reduce((s, r) => s + r.balance, 0) -
    expense.reduce((s, r) => s + r.balance, 0);
  return { revenue, expense, netIncome };
}

export interface BalanceSheet {
  asset: { account: Account; balance: number }[];
  liability: { account: Account; balance: number }[];
  equity: { account: Account; balance: number }[];
  /** Plug laba ditahan: revenue - expense periode berjalan. */
  retainedEarnings: number;
  balanced: boolean;
}

// cubic r3 accounting:515 — SATU implementasi neraca; balanceSheet dan
// financialReports memakai helper ini supaya tidak drift.
function balanceFromTb(
  tb: Awaited<ReturnType<typeof trialBalanceService>>,
): BalanceSheet {
  const pick = (type: AccountType) =>
    tb.lines
      .map((l) => ({
        account: tb.accountById.get(
          [...tb.accountById.values()].find((a) => a.code === l.accountCode)
            ?.id ?? "",
        )!,
        balance: l.balance,
      }))
      .filter((x) => x.account && x.account.type === type);
  const sum = (xs: { balance: number }[]) =>
    xs.reduce((s, x) => s + x.balance, 0);
  const asset = pick("asset");
  const liability = pick("liability");
  const equity = pick("equity");
  const retainedEarnings = incomeStatementFromTb(tb).netIncome;
  const totalAsset = sum(asset);
  const totalRhs = sum(liability) + sum(equity) + retainedEarnings;
  return {
    asset,
    liability,
    equity,
    retainedEarnings,
    balanced: totalAsset === totalRhs,
  };
}

export async function balanceSheet(orgId: string): Promise<BalanceSheet> {
  // Satu snapshot trial balance untuk SEMUA komponen (cubic P2
  // accounting:444) — income statement dihitung dari tb yang sama, bukan
  // query kedua, sehingga concurrent posting tidak bisa menghasilkan
  // neraca self-inconsistent.
  const tb = await trialBalanceService(orgId);
  return balanceFromTb(tb);
}

// ---------------- Laporan gabungan (cubic pr8 laporan:67/:68) ----------------

export interface FinancialReports {
  income: IncomeStatement;
  balance: BalanceSheet;
}

/**
 * Satu pemanggilan untuk halaman laporan: snapshot kumulatif untuk neraca
 * (laba ditahan kumulatif, `balanced` konsisten) plus — bila `period` diisi —
 * snapshot kedua berfilter bulan kalender untuk Laba Rugi "periode berjalan".
 * Tanpa period, satu scan saja (income dihitung dari snapshot yang sama).
 */
export async function financialReports(
  orgId: string,
  period?: string, // "YYYY-MM"
): Promise<FinancialReports> {
  const tb = await trialBalanceService(orgId);
  const income = period
    ? incomeStatementFromTb(await trialBalanceService(orgId, period))
    : incomeStatementFromTb(tb);
  // cubic r3 accounting:515 — hitung neraca lewat SATU implementasi
  // (helper yang sama dipakai balanceSheet) supaya tidak drift.
  const balance = balanceFromTb(tb);
  return {
    income,
    balance,
  };
}
