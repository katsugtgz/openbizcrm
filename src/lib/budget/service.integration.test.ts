import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { organizations, orgMemberships, users } from "@/db/schema";

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

      // member tak boleh set budget — kontrak admin-only diverifikasi eksplisit
      // (cubic pr8 budget-test:82); owner lolos karena role >= admin.
      const member = await (
        await import("@/lib/repos/user-repo")
      ).createUser({
        workosUserId: `it-bud-${suffix}-m`,
        email: `it-bud-${suffix}-m@test.id`,
      });
      createdUserIds.push(member.id);
      const { db: dbx } = await import("@/db");
      await dbx.insert(orgMemberships).values({
        orgId: o.orgId,
        userId: member.id,
        role: "member",
      });
      await expect(
        budget.setBudget(member.id, o.orgId, {
          accountId: expense.id,
          period: "2026-11",
          amount: 1,
        }),
      ).rejects.toThrow(/Peran admin|INSUFFICIENT_ROLE/i);

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

  // cubic pr8 budget:32 — periode bulan mustahil (00/13) ditolak di semua
  // entry point, bukan lolos sebagai data bodoh.
  itDb("periode bulan tidak valid (00/13) ditolak", async () => {
    const o = await makeOrg();
    const expense = await acct.createAccount(o.userId, o.orgId, {
      code: "5-3000",
      name: "Beban Tes",
      type: "expense",
    });
    await expect(
      budget.setBudget(o.userId, o.orgId, {
        accountId: expense.id,
        period: "2026-13",
        amount: 1,
      }),
    ).rejects.toThrow(/bulan/i);
    await expect(
      budget.setBudget(o.userId, o.orgId, {
        accountId: expense.id,
        period: "2026-00",
        amount: 1,
      }),
    ).rejects.toThrow(/bulan/i);
    await expect(
      budget.actualForPeriod(o.orgId, expense.id, "2026-13"),
    ).rejects.toThrow(/bulan/i);
    await expect(budget.actualVsBudget(o.orgId, "2026-00")).rejects.toThrow(
      /bulan/i,
    );
  });

  // cubic pr8 budget:98 — agregat bigint -> Number diam-diam rounding.
  // Actual di atas MAX_SAFE ditolak, bukan dilaporkan salah angka.
  itDb("aktual di atas MAX_SAFE ditolak (bukan dibulatkan)", async () => {
    const o = await makeOrg();
    const expense = await acct.createAccount(o.userId, o.orgId, {
      code: "5-4000",
      name: "Beban Besar",
      type: "expense",
    });
    const cash = await acct.createAccount(o.userId, o.orgId, {
      code: "1-5000",
      name: "Kas Besar",
      type: "asset",
    });
    const sales = await acct.createAccount(o.userId, o.orgId, {
      code: "4-5000",
      name: "Penjualan Besar",
      type: "revenue",
    });
    // Tulis agregasi melebihi MAX_SAFE langsung (melewati validator entri,
    // simulasi ledger historis/legacy): dua baris debit MAX_SAFE utk akun sama.
    const { journalEntries, journalLines } = await import("@/db/schema");
    const [entry] = await db
      .insert(journalEntries)
      .values({
        orgId: o.orgId,
        entryNumber: 1,
        date: "2026-11-05",
        status: "posted",
        source: "manual",
        postedAt: new Date(),
      })
      .returning();
    await db.insert(journalLines).values([
      {
        orgId: o.orgId,
        entryId: entry.id,
        accountId: expense.id,
        debit: Number.MAX_SAFE_INTEGER - 2,
        credit: 0,
      },
      {
        orgId: o.orgId,
        entryId: entry.id,
        accountId: expense.id,
        debit: 2,
        credit: 0,
      },
      {
        orgId: o.orgId,
        entryId: entry.id,
        accountId: cash.id,
        debit: Number.MAX_SAFE_INTEGER - 2,
        credit: 0,
      },
      {
        orgId: o.orgId,
        entryId: entry.id,
        accountId: sales.id,
        debit: 0,
        credit: Number.MAX_SAFE_INTEGER - 2,
      },
      {
        // Baris kedua di-split agar tiap baris di bawah cap per baris DB
        // (journal_lines_amounts_check, 0019); agregat lintas baris tetap
        // melebihi MAX_SAFE — kasus yang diuji tetap rounding-reject.
        orgId: o.orgId,
        entryId: entry.id,
        accountId: sales.id,
        debit: 0,
        credit: Number.MAX_SAFE_INTEGER,
      },
    ]);
    // Agregat beban = MAX_SAFE tepat -> masih ok.
    const actual = await budget.actualForPeriod(o.orgId, expense.id, "2026-11");
    expect(actual).toBe(Number.MAX_SAFE_INTEGER);
    // Satu rupiah lagi -> melebihi MAX_SAFE -> service menolak, bukan rounding.
    await db.insert(journalLines).values({
      orgId: o.orgId,
      entryId: entry.id,
      accountId: expense.id,
      debit: 1,
      credit: 0,
    });
    await expect(
      budget.actualForPeriod(o.orgId, expense.id, "2026-11"),
    ).rejects.toThrow(/MAX_SAFE/);
    await expect(budget.actualVsBudget(o.orgId, "2026-11")).rejects.toThrow(
      /MAX_SAFE/,
    );
  });
});
