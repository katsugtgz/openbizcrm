import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  budgets,
  journalEntries,
  journalLines,
  type Account,
  type Budget,
} from "@/db/schema";
import { NotFoundError, OrgScopeError, requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";
import { assertSafeAmount } from "@/lib/money";

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetError";
  }
}

/**
 * Set/replace anggaran bulanan per akun (admin saja). Upsert pada
 * unique (org, account, period).
 */
export async function setBudget(
  userId: string,
  orgId: string,
  input: { accountId: string; period: string; amount: number },
): Promise<Budget> {
  await requireOrgRole(userId, orgId, "admin");
  if (!/^\d{4}-\d{2}$/.test(input.period)) {
    throw new BudgetError("Format periode harus YYYY-MM.");
  }
  assertSafeAmount(input.amount, "Jumlah anggaran");
  // Akun wajib milik org dan tipe expense (anggaran beban).
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.orgId, orgId)))
    .limit(1);
  if (!account) throw new NotFoundError("Akun tidak ditemukan.");
  if (account.type !== "expense") {
    throw new BudgetError("Anggaran hanya untuk akun beban (expense).");
  }
  const [row] = await db
    .insert(budgets)
    .values({
      orgId,
      accountId: input.accountId,
      period: input.period,
      amount: input.amount,
      createdBy: userId,
    })
    .onConflictDoUpdate({
      target: [budgets.orgId, budgets.accountId, budgets.period],
      set: { amount: input.amount, createdBy: userId },
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "budget.set",
    entity: "budget",
    entityId: row.id,
    metadata: {
      period: input.period,
      amount: input.amount,
      account: account.code,
    },
  });
  return row;
}

/** Aktual posted satu akun beban bulan kalender tertentu (debit - credit). */
export async function actualForPeriod(
  orgId: string,
  accountId: string,
  period: string,
): Promise<number> {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new BudgetError("Format periode harus YYYY-MM.");
  }
  const [row] = await db
    .select({
      actual: sql<number>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.orgId, orgId),
        eq(journalLines.accountId, accountId),
        eq(journalEntries.status, "posted"),
        sql`to_char(${journalEntries.date}::text::date, 'YYYY-MM') = ${period}`,
      ),
    );
  return Number(row?.actual ?? 0);
}

export interface BudgetVsActual {
  account: Account;
  budget: number | null; // null = tidak ada anggaran utk periode ini
  actual: number;
}

/** Perbandingan anggaran vs aktual posted per akun beban, satu periode. */
export async function actualVsBudget(
  orgId: string,
  period: string, // "YYYY-MM"
): Promise<BudgetVsActual[]> {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new BudgetError("Format periode harus YYYY-MM.");
  }
  const accountRows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.type, "expense")));
  const budgetRows = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.orgId, orgId), eq(budgets.period, period)));
  const budgetByAccount = new Map(
    budgetRows.map((b) => [b.accountId, b.amount]),
  );
  // Aktual per akun = sum(debit - credit) posted pada bulan kalender period.
  const actualRows = await db
    .select({
      accountId: journalLines.accountId,
      actual: sql<number>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.orgId, orgId),
        eq(journalEntries.status, "posted"),
        sql`to_char(${journalEntries.date}::text::date, 'YYYY-MM') = ${period}`,
      ),
    )
    .groupBy(journalLines.accountId);
  const actualByAccount = new Map(
    actualRows.map((r) => [r.accountId, Number(r.actual)]),
  );
  return accountRows.map((account) => ({
    account,
    budget: budgetByAccount.get(account.id) ?? null,
    actual: actualByAccount.get(account.id) ?? 0,
  }));
}

void OrgScopeError;
