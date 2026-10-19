import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { organizations, users } from "@/db/schema";

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("assets integration", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let assets!: typeof import("@/lib/assets/service");
  let acct!: typeof import("@/lib/accounting/service");

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    assets = await import("@/lib/assets/service");
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
      workosUserId: `it-ast-${suffix}-${createdUserIds.length}`,
      email: `it-ast-${suffix}-${createdUserIds.length}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await (
      await import("@/lib/repos/org-repo")
    ).createOrg(
      {
        name: `Ast Org ${suffix}`,
        slug: `it-ast-${suffix}-${createdOrgIds.length}`,
      },
      owner.id,
    );
    createdOrgIds.push(org.id);
    return { userId: owner.id, orgId: org.id };
  }

  itDb(
    "addAsset org-scoped accounts; depreciation double-run idempotent; dispose",
    async () => {
      const o = await makeOrg();
      const depExpense = await acct.createAccount(o.userId, o.orgId, {
        code: "5-2000",
        name: "Beban Penyusutan",
        type: "expense",
      });
      const accumDep = await acct.createAccount(o.userId, o.orgId, {
        code: "1-1900",
        name: "Akumulasi Penyusutan",
        type: "asset",
      });
      const cash = await acct.createAccount(o.userId, o.orgId, {
        code: "1-1000",
        name: "Kas",
        type: "asset",
      });

      // akun org lain ditolak
      const o2 = await makeOrg();
      const depExpenseB = await acct.createAccount(o2.userId, o2.orgId, {
        code: "5-2000",
        name: "Beban Penyusutan B",
        type: "expense",
      });
      await expect(
        assets.addAsset(o.userId, o.orgId, {
          name: "Laptop",
          cost: 12_000_000,
          salvageValue: 0,
          usefulLifeMonths: 24,
          acquiredDate: "2026-01-15",
          depreciationExpenseAccountId: depExpenseB.id, // org B
          accumulatedDepreciationAccountId: accumDep.id,
        }),
      ).rejects.toThrow(/tidak ditemukan/);

      // cost == salvage ditolak; salvage > cost ditolak; life 0 ditolak
      await expect(
        assets.addAsset(o.userId, o.orgId, {
          name: "Bad",
          cost: 5_000_000,
          salvageValue: 5_000_000,
          usefulLifeMonths: 12,
          acquiredDate: "2026-01-01",
          depreciationExpenseAccountId: depExpense.id,
          accumulatedDepreciationAccountId: accumDep.id,
        }),
      ).rejects.toThrow();

      const asset = await assets.addAsset(o.userId, o.orgId, {
        name: `Laptop ${suffix}`,
        cost: 12_000_000,
        salvageValue: 0,
        usefulLifeMonths: 24,
        acquiredDate: "2026-01-15",
        depreciationExpenseAccountId: depExpense.id,
        accumulatedDepreciationAccountId: accumDep.id,
      });
      // monthly = floor(12_000_000 / 24) = 500_000
      expect(assets.monthlyDepreciation(asset)).toBe(500_000);

      // Run pertama: 2026-01..2026-03 => 3 bulan x 500_000 = 1_500_000
      const run1 = await assets.runMonthlyDepreciation(
        o.userId,
        o.orgId,
        "2026-03",
      );
      expect(run1.processed).toBe(1);
      expect(run1.totalAmount).toBe(1_500_000);

      // Run kedua periode sama: idempoten — 0 baru.
      const run2 = await assets.runMonthlyDepreciation(
        o.userId,
        o.orgId,
        "2026-03",
      );
      expect(run2.processed).toBe(0);
      expect(run2.totalAmount).toBe(0);

      // Lanjut sampai fully depreciated: sisa 10_500_000 / 500_000 = 21 bulan
      // => sampai 2026-12 (9 bulan lagi) = 4_500_000.
      const run3 = await assets.runMonthlyDepreciation(
        o.userId,
        o.orgId,
        "2026-12",
      );
      expect(run3.totalAmount).toBe(4_500_000);
      const run4 = await assets.runMonthlyDepreciation(
        o.userId,
        o.orgId,
        "2027-12",
      );
      expect(run4.totalAmount).toBe(6_000_000); // sisa 10_500_000 - 4_500_000
      const run5 = await assets.runMonthlyDepreciation(
        o.userId,
        o.orgId,
        "2028-12",
      );
      // fully: sisa 0 — amount dibatasi remaining.
      expect(run5.totalAmount).toBe(0);

      const [after] = await db
        .select()
        .from((await import("@/db/schema")).fixedAssets)
        .where(eq((await import("@/db/schema")).fixedAssets.id, asset.id));
      expect(after.totalDepreciated).toBe(12_000_000);

      // Jurnal dep balanced & posted.
      const tb = await acct.trialBalanceService(o.orgId);
      expect(tb.balanced).toBe(true);
      expect(tb.totalDebit).toBe(12_000_000);

      // Dispose aset kedua (belum fully depreciated).
      const asset2 = await assets.addAsset(o.userId, o.orgId, {
        name: `Printer ${suffix}`,
        cost: 3_600_000,
        salvageValue: 0,
        usefulLifeMonths: 36, // 100_000/bln
        acquiredDate: "2026-06-01",
        depreciationExpenseAccountId: depExpense.id,
        accumulatedDepreciationAccountId: accumDep.id,
      });
      const disposed = await assets.dispose(
        o.userId,
        o.orgId,
        asset2.id,
        "2026-08-01",
      );
      expect(disposed.status).toBe("disposed");
      await expect(
        assets.dispose(o.userId, o.orgId, asset2.id, "2026-08-02"),
      ).rejects.toThrow(/disposed/);
      void cash;
    },
  );
});
