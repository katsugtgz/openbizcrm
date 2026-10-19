import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { fiscalPeriods, organizations, users } from "@/db/schema";

// DB-touching modules load ONLY when RUN_DB_TESTS=1 (lazy-import pattern,
// sama dengan crm.integration.test.ts).
type AcctSvc = typeof import("@/lib/accounting/service");

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("accounting integration", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let acct!: AcctSvc;

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
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
      workosUserId: `it-acct-${suffix}-${createdUserIds.length}`,
      email: `it-acct-${suffix}-${createdUserIds.length}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await (
      await import("@/lib/repos/org-repo")
    ).createOrg(
      {
        name: `Acct Org ${suffix}`,
        slug: `it-acct-${suffix}-${createdOrgIds.length}`,
      },
      owner.id,
    );
    createdOrgIds.push(org.id);
    return { userId: owner.id, orgId: org.id };
  }

  itDb(
    "post balanced ok; unbalanced rejected; closed period blocks; entryNumber sequential; org isolation; org code unique",
    async () => {
      const ownerA = await makeOrg();
      // --- chart of accounts org A ---
      const cash = await acct.createAccount(ownerA.userId, ownerA.orgId, {
        code: "1-1000",
        name: "Kas",
        type: "asset",
      });
      const sales = await acct.createAccount(ownerA.userId, ownerA.orgId, {
        code: "4-1000",
        name: "Pendapatan",
        type: "revenue",
      });
      const expense = await acct.createAccount(ownerA.userId, ownerA.orgId, {
        code: "5-1000",
        name: "Beban",
        type: "expense",
      });
      // Kode akun unik per org: duplikat di org sama ditolak.
      await expect(
        acct.createAccount(ownerA.userId, ownerA.orgId, {
          code: "1-1000",
          name: "Duplikat",
          type: "asset",
        }),
      ).rejects.toThrow();

      // --- balanced entry posts ok, nomor urut 1 ---
      const e1 = await acct.createJournalEntry(ownerA.userId, ownerA.orgId, {
        date: "2026-10-05",
        description: "Penjualan tunai",
        lines: [
          { accountId: cash.id, debit: 500_000, credit: 0 },
          { accountId: sales.id, debit: 0, credit: 500_000 },
        ],
      });
      const posted1 = await acct.postEntry(
        ownerA.userId,
        ownerA.orgId,
        e1.entry.id,
      );
      expect(posted1.status).toBe("posted");
      expect(posted1.entryNumber).toBe(1);

      // --- unbalanced rejected ---
      await expect(
        acct.createJournalEntry(ownerA.userId, ownerA.orgId, {
          date: "2026-10-06",
          lines: [
            { accountId: cash.id, debit: 100, credit: 0 },
            { accountId: sales.id, debit: 0, credit: 90 },
          ],
        }),
      ).rejects.toThrow(/selisih 10/);

      // --- sequential entryNumber, no dup (post cepat berurutan) ---
      const drafts = await Promise.all(
        [1, 2, 3].map((i) =>
          acct.createJournalEntry(ownerA.userId, ownerA.orgId, {
            date: "2026-10-07",
            lines: [
              { accountId: cash.id, debit: 1000 * i, credit: 0 },
              { accountId: sales.id, debit: 0, credit: 1000 * i },
            ],
          }),
        ),
      );
      const posted = await Promise.all(
        drafts.map((d) =>
          acct.postEntry(ownerA.userId, ownerA.orgId, d.entry.id),
        ),
      );
      const nums = posted.map((p) => p.entryNumber).sort((a, b) => a - b);
      expect(nums).toEqual([2, 3, 4]);

      // --- ledger running balance ---
      const ledger = await acct.listLedger(ownerA.orgId, cash.id);
      expect(ledger).toHaveLength(4);
      expect(ledger[ledger.length - 1].runningBalance).toBe(506_000);

      // --- trial balance cross-foot ---
      const tb = await acct.trialBalanceService(ownerA.orgId);
      expect(tb.balanced).toBe(true);
      expect(tb.totalDebit).toBe(506_000);

      // --- income statement & balance sheet plug ---
      const inc = await acct.incomeStatement(ownerA.orgId);
      expect(inc.netIncome).toBe(506_000);
      const bs = await acct.balanceSheet(ownerA.orgId);
      expect(bs.balanced).toBe(true);
      expect(bs.retainedEarnings).toBe(506_000);

      // --- closed period blocks posting ---
      await acct.closePeriod(ownerA.userId, ownerA.orgId, "2026-10");
      const [fp] = await db
        .select()
        .from(fiscalPeriods)
        .where(eq(fiscalPeriods.orgId, ownerA.orgId));
      expect(fp.closed).toBe(true);
      const draftBlocked = await acct.createJournalEntry(
        ownerA.userId,
        ownerA.orgId,
        {
          date: "2026-10-20",
          lines: [
            { accountId: cash.id, debit: 5, credit: 0 },
            { accountId: sales.id, debit: 0, credit: 5 },
          ],
        },
      );
      await expect(
        acct.postEntry(ownerA.userId, ownerA.orgId, draftBlocked.entry.id),
      ).rejects.toThrow(/ditutup/);

      // --- cross-org isolation ---
      const ownerB = await makeOrg();
      const cashB = await acct.createAccount(ownerB.userId, ownerB.orgId, {
        code: "1-1000", // sama dengan org A — unik per org, bukan global
        name: "Kas B",
        type: "asset",
      });
      const salesB = await acct.createAccount(ownerB.userId, ownerB.orgId, {
        code: "4-1000",
        name: "Pendapatan B",
        type: "revenue",
      });
      // Akun org A tidak terlihat dari org B.
      await expect(
        acct.createJournalEntry(ownerB.userId, ownerB.orgId, {
          date: "2026-11-01",
          lines: [
            { accountId: cash.id, debit: 1, credit: 0 }, // akun org A
            { accountId: salesB.id, debit: 0, credit: 1 },
          ],
        }),
      ).rejects.toThrow(/tidak ditemukan/);
      // Posting entri org A lewat konteks org B gagal.
      await expect(
        acct.postEntry(ownerB.userId, ownerB.orgId, e1.entry.id),
      ).rejects.toThrow(/tidak ditemukan/);
      const eB = await acct.createJournalEntry(ownerB.userId, ownerB.orgId, {
        date: "2026-11-01",
        lines: [
          { accountId: cashB.id, debit: 7, credit: 0 },
          { accountId: salesB.id, debit: 0, credit: 7 },
        ],
      });
      const postedB = await acct.postEntry(
        ownerB.userId,
        ownerB.orgId,
        eB.entry.id,
      );
      // Nomor jurnal org B mulai dari 1 — isolasi penuh.
      expect(postedB.entryNumber).toBe(1);
      const tbB = await acct.trialBalanceService(ownerB.orgId);
      expect(tbB.totalDebit).toBe(7);

      void expense;
    },
  );
});
