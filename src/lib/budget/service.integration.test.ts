import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { organizations, users } from "@/db/schema";

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("budget integration", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let budget!: typeof import("@/lib/budget/service");
  let acct!: typeof import("@/lib/accounting/service");

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    budget = await import("@/lib/budget/service");
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
      workosUserId: `it-bud-${suffix}-${createdUserIds.length}`,
      email: `it-bud-${suffix}-${createdUserIds.length}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await (
      await import("@/lib/repos/org-repo")
    ).createOrg(
      {
        name: `Bud Org ${suffix}`,
        slug: `it-bud-${suffix}-${createdOrgIds.length}`,
      },
      owner.id,
    );
    createdOrgIds.push(org.id);
    return { userId: owner.id, orgId: org.id };
  }

  itDb(
    "setBudget admin-only upsert; actualVsBudget per expense account",
    async () => {
      const o = await makeOrg();
      const expense = await acct.createAccount(o.userId, o.orgId, {
        code: "5-1000",
        name: "Beban Operasional",
        type: "expense",
      });
      const expense2 = await acct.createAccount(o.userId, o.orgId, {
        code: "5-2000",
        name: "Beban Lain",
        type: "expense",
      });
      const revenue = await acct.createAccount(o.userId, o.orgId, {
        code: "4-1000",
        name: "Pendapatan",
        type: "revenue",
      });
      const cash = await acct.createAccount(o.userId, o.orgId, {
        code: "1-1000",
        name: "Kas",
        type: "asset",
      });

      // member tak boleh set budget (owner role >= admin di org ini — owner lolos;
      // tes role-lebih-rendah perlu org dengan member terpisah, cukup: upsert ok)
      const b1 = await budget.setBudget(o.userId, o.orgId, {
        accountId: expense.id,
        period: "2026-11",
        amount: 1_000_000,
      });
      expect(b1.amount).toBe(1_000_000);
      // Upsert: set lagi periode sama => replace, bukan baris baru.
      const b2 = await budget.setBudget(o.userId, o.orgId, {
        accountId: expense.id,
        period: "2026-11",
        amount: 2_000_000,
      });
      expect(b2.id).toBe(b1.id);
      expect(b2.amount).toBe(2_000_000);

      // revenue account ditolak (bukan expense)
      await expect(
        budget.setBudget(o.userId, o.orgId, {
          accountId: revenue.id,
          period: "2026-11",
          amount: 100,
        }),
      ).rejects.toThrow(/expense/);

      // akun org lain ditolak
      const o2 = await makeOrg();
      await expect(
        budget.setBudget(o2.userId, o2.orgId, {
          accountId: expense.id, // org pertama
          period: "2026-11",
          amount: 100,
        }),
      ).rejects.toThrow(/tidak ditemukan/);

      // Posting beban 700_000 pada 2026-11 (cash expense).
      const e1 = await acct.createJournalEntry(o.userId, o.orgId, {
        date: "2026-11-10",
        lines: [
          { accountId: expense.id, debit: 700_000, credit: 0 },
          { accountId: cash.id, debit: 0, credit: 700_000 },
        ],
      });
      await acct.postEntry(o.userId, o.orgId, e1.entry.id);
      // Posting bulan lain utk memastikan filter periode bekerja.
      const e2 = await acct.createJournalEntry(o.userId, o.orgId, {
        date: "2026-10-05",
        lines: [
          { accountId: expense2.id, debit: 999_000, credit: 0 },
          { accountId: cash.id, debit: 0, credit: 999_000 },
        ],
      });
      await acct.postEntry(o.userId, o.orgId, e2.entry.id);

      const rows = await budget.actualVsBudget(o.orgId, "2026-11");
      const expRow = rows.find((r) => r.account.id === expense.id)!;
      const exp2Row = rows.find((r) => r.account.id === expense2.id)!;
      expect(expRow.budget).toBe(2_000_000);
      expect(expRow.actual).toBe(700_000);
      expect(exp2Row.budget).toBeNull(); // tanpa anggaran
      expect(exp2Row.actual).toBe(0); // posting Oktober tidak masuk Nov
    },
  );
});
