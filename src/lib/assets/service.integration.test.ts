import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  fixedAssets,
  journalEntries,
  journalLines,
  organizations,
  users,
} from "@/db/schema";

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

  async function makeDepAccounts(
    userId: string,
    orgId: string,
    tag: string,
  ): Promise<{ depExpense: { id: string }; accumDep: { id: string } }> {
    const depExpense = await acct.createAccount(userId, orgId, {
      code: `5-2${tag}`,
      name: "Beban Penyusutan",
      type: "expense",
    });
    const accumDep = await acct.createAccount(userId, orgId, {
      code: `1-19${tag}`,
      name: "Akumulasi Penyusutan",
      type: "asset",
    });
    return { depExpense, accumDep };
  }

  async function depDebitSum(
    orgId: string,
    expenseAccountId: string,
  ): Promise<number> {
    const rows = await db
      .select({ total: sql<number>`coalesce(sum(${journalLines.debit}), 0)` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(
        and(
          eq(journalLines.orgId, orgId),
          eq(journalLines.accountId, expenseAccountId),
          eq(journalEntries.source, "depreciation"),
        ),
      );
    return Number(rows[0].total);
  }

  async function getAsset(assetId: string) {
    const [row] = await db
      .select()
      .from(fixedAssets)
      .where(eq(fixedAssets.id, assetId));
    return row;
  }

  itDb("addAsset menolak tipe akun salah dan akun kembar", async () => {
    const o = await makeOrg();
    const { depExpense, accumDep } = await makeDepAccounts(
      o.userId,
      o.orgId,
      "a",
    );
    const otherAsset = await acct.createAccount(o.userId, o.orgId, {
      code: "1-1000",
      name: "Kas",
      type: "asset",
    });
    const miscExpense = await acct.createAccount(o.userId, o.orgId, {
      code: "5-9",
      name: "Beban Lain",
      type: "expense",
    });

    // beban penyusutan harus expense
    await expect(
      assets.addAsset(o.userId, o.orgId, {
        name: "Wrong expense type",
        cost: 1_000_000,
        usefulLifeMonths: 12,
        acquiredDate: "2026-01-01",
        depreciationExpenseAccountId: otherAsset.id, // type asset
        accumulatedDepreciationAccountId: accumDep.id,
      }),
    ).rejects.toThrow(/expense/);

    // akumulasi harus asset (dua akun berbeda, keduanya expense)
    await expect(
      assets.addAsset(o.userId, o.orgId, {
        name: "Wrong accum type",
        cost: 1_000_000,
        usefulLifeMonths: 12,
        acquiredDate: "2026-01-01",
        depreciationExpenseAccountId: depExpense.id,
        accumulatedDepreciationAccountId: miscExpense.id, // type expense
      }),
    ).rejects.toThrow(/asset/);

    // dua akun harus berbeda
    await expect(
      assets.addAsset(o.userId, o.orgId, {
        name: "Same account",
        cost: 1_000_000,
        usefulLifeMonths: 12,
        acquiredDate: "2026-01-01",
        depreciationExpenseAccountId: depExpense.id,
        accumulatedDepreciationAccountId: depExpense.id,
      }),
    ).rejects.toThrow(/berbeda/);

    // input invalid terpisah: salvage > cost, dan life 0 (cubic pr8 assets-test:94)
    await expect(
      assets.addAsset(o.userId, o.orgId, {
        name: "Salvage over cost",
        cost: 1_000,
        salvageValue: 2_000,
        usefulLifeMonths: 12,
        acquiredDate: "2026-01-01",
        depreciationExpenseAccountId: depExpense.id,
        accumulatedDepreciationAccountId: accumDep.id,
      }),
    ).rejects.toThrow(/Nilai sisa/);
    await expect(
      assets.addAsset(o.userId, o.orgId, {
        name: "Zero life",
        cost: 1_000_000,
        usefulLifeMonths: 0,
        acquiredDate: "2026-01-01",
        depreciationExpenseAccountId: depExpense.id,
        accumulatedDepreciationAccountId: accumDep.id,
      }),
    ).rejects.toThrow(/Umur ekonomis/);

    // isolasi org dua arah: expense org A + akumulasi org B juga ditolak
    // (cubic pr8 assets-test:89) — kasus asli hanya mencakup field expense.
    const oB = await makeOrg();
    const { accumDep: accumDepB } = await makeDepAccounts(
      oB.userId,
      oB.orgId,
      "ab",
    );
    await expect(
      assets.addAsset(o.userId, o.orgId, {
        name: "Cross-org accum",
        cost: 1_000_000,
        usefulLifeMonths: 12,
        acquiredDate: "2026-01-01",
        depreciationExpenseAccountId: depExpense.id,
        accumulatedDepreciationAccountId: accumDepB.id,
      }),
    ).rejects.toThrow(/tidak ditemukan/);
  });

  itDb("periode bulan 00/13 ditolak", async () => {
    const o = await makeOrg();
    await expect(
      assets.runMonthlyDepreciation(o.userId, o.orgId, "2026-00"),
    ).rejects.toThrow(/YYYY-MM/);
    await expect(
      assets.runMonthlyDepreciation(o.userId, o.orgId, "2026-13"),
    ).rejects.toThrow(/YYYY-MM/);
  });

  itDb(
    "depresiasi happy path: catch-up bulan terakhir, tanggal jurnal akhir bulan, fully-depreciated tetap active",
    async () => {
      const o = await makeOrg();
      const { depExpense, accumDep } = await makeDepAccounts(
        o.userId,
        o.orgId,
        "b",
      );

      const asset = await assets.addAsset(o.userId, o.orgId, {
        name: `Laptop ${suffix}`,
        cost: 12_000_000,
        salvageValue: 0,
        usefulLifeMonths: 24,
        acquiredDate: "2026-01-15",
        depreciationExpenseAccountId: depExpense.id,
        accumulatedDepreciationAccountId: accumDep.id,
      });
      expect(assets.monthlyDepreciation(asset)).toBe(500_000);

      const run1 = await assets.runMonthlyDepreciation(
        o.userId,
        o.orgId,
        "2026-03",
      );
      expect(run1.processed).toBe(1);
      expect(run1.totalAmount).toBe(1_500_000);

      // Jurnal depresiasi bertanggal hari terakhir bulan periode (2026-03-31).
      const [entry] = await db
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.orgId, o.orgId),
            eq(journalEntries.source, "depreciation"),
          ),
        );
      expect(entry.date).toBe("2026-03-31");

      // Run kedua periode sama: idempoten — 0 baru.
      const run2 = await assets.runMonthlyDepreciation(
        o.userId,
        o.orgId,
        "2026-03",
      );
      expect(run2.processed).toBe(0);
      expect(run2.totalAmount).toBe(0);

      // 2026-04..2026-12: 9 x 500_000.
      const run3 = await assets.runMonthlyDepreciation(
        o.userId,
        o.orgId,
        "2026-12",
      );
      expect(run3.totalAmount).toBe(4_500_000);

      // Bulan terakhir umur (ke-24 = 2027-12): catch-up sisa 6_000_000
      // sehingga aset habis tepat di bulan ke-usefulLifeMonths.
      const run4 = await assets.runMonthlyDepreciation(
        o.userId,
        o.orgId,
        "2027-12",
      );
      expect(run4.totalAmount).toBe(6_000_000);
      const run5 = await assets.runMonthlyDepreciation(
        o.userId,
        o.orgId,
        "2028-12",
      );
      expect(run5.totalAmount).toBe(0);

      const after = await getAsset(asset.id);
      expect(after.totalDepreciated).toBe(12_000_000);
      // Fully-depreciated bukan disposal — status tetap active agar masih
      // bisa masuk alur disposal nyata.
      expect(after.status).toBe("active");

      const tb = await acct.trialBalanceService(o.orgId);
      expect(tb.balanced).toBe(true);
      expect(tb.totalDebit).toBe(12_000_000);
      expect(await depDebitSum(o.orgId, depExpense.id)).toBe(12_000_000);
    },
  );

  itDb(
    "base < life (monthly floor 0): tetap terdepresiasi penuh lewat catch-up bulan terakhir",
    async () => {
      const o = await makeOrg();
      const { depExpense, accumDep } = await makeDepAccounts(
        o.userId,
        o.orgId,
        "c",
      );
      const asset = await assets.addAsset(o.userId, o.orgId, {
        name: "Tiny",
        cost: 20,
        salvageValue: 0,
        usefulLifeMonths: 24, // floor(20/24) = 0 per bulan
        acquiredDate: "2026-01-01",
        depreciationExpenseAccountId: depExpense.id,
        accumulatedDepreciationAccountId: accumDep.id,
      });

      // Sebelum bulan terakhir: 0 per bulan, diskip.
      const mid = await assets.runMonthlyDepreciation(
        o.userId,
        o.orgId,
        "2026-12",
      );
      expect(mid.processed).toBe(0);
      expect(mid.totalAmount).toBe(0);

      // Bulan terakhir (ke-24 = 2027-12): posting seluruh sisa 20.
      const finalRun = await assets.runMonthlyDepreciation(
        o.userId,
        o.orgId,
        "2027-12",
      );
      expect(finalRun.processed).toBe(1);
      expect(finalRun.totalAmount).toBe(20);
      const after = await getAsset(asset.id);
      expect(after.totalDepreciated).toBe(20);
    },
  );

  itDb("periode fiskal ditutup memblokir depresiasi", async () => {
    const o = await makeOrg();
    const { depExpense, accumDep } = await makeDepAccounts(
      o.userId,
      o.orgId,
      "d",
    );
    const asset = await assets.addAsset(o.userId, o.orgId, {
      name: "Blocked",
      cost: 1_200_000,
      salvageValue: 0,
      usefulLifeMonths: 12,
      acquiredDate: "2026-01-01",
      depreciationExpenseAccountId: depExpense.id,
      accumulatedDepreciationAccountId: accumDep.id,
    });
    await acct.closePeriod(o.userId, o.orgId, "2026-01");
    await expect(
      assets.runMonthlyDepreciation(o.userId, o.orgId, "2026-01"),
    ).rejects.toThrow(/ditutup/);
    const after = await getAsset(asset.id);
    expect(after.totalDepreciated).toBe(0);
    expect(await depDebitSum(o.orgId, depExpense.id)).toBe(0);
  });

  itDb(
    "run depresiasi konkuren ganda: jurnal tidak dobel (first-caller-wins)",
    async () => {
      const o = await makeOrg();
      const { depExpense, accumDep } = await makeDepAccounts(
        o.userId,
        o.orgId,
        "e",
      );
      const asset = await assets.addAsset(o.userId, o.orgId, {
        name: `Race ${suffix}`,
        cost: 12_000_000,
        salvageValue: 0,
        usefulLifeMonths: 24,
        acquiredDate: "2026-01-01",
        depreciationExpenseAccountId: depExpense.id,
        accumulatedDepreciationAccountId: accumDep.id,
      });
      const [r1, r2] = await Promise.all([
        assets.runMonthlyDepreciation(o.userId, o.orgId, "2026-03"),
        assets.runMonthlyDepreciation(o.userId, o.orgId, "2026-03"),
      ]);
      // Tepat satu run yang memposting; run lain skip (idempoten).
      expect(r1.processed + r2.processed).toBe(1);
      expect(await depDebitSum(o.orgId, depExpense.id)).toBe(1_500_000);
      const after = await getAsset(asset.id);
      expect(after.totalDepreciated).toBe(1_500_000);
      expect(after.lastDepreciatedPeriod).toBe("2026-03");
    },
  );

  itDb(
    "disposal bersamaan dengan depresiasi: status tidak dihidupkan ulang",
    async () => {
      const o = await makeOrg();
      const { depExpense, accumDep } = await makeDepAccounts(
        o.userId,
        o.orgId,
        "f",
      );
      const asset = await assets.addAsset(o.userId, o.orgId, {
        name: `Dispose race ${suffix}`,
        cost: 12_000_000,
        salvageValue: 0,
        usefulLifeMonths: 24,
        acquiredDate: "2026-01-01",
        depreciationExpenseAccountId: depExpense.id,
        accumulatedDepreciationAccountId: accumDep.id,
      });
      await Promise.all([
        assets.runMonthlyDepreciation(o.userId, o.orgId, "2026-12"),
        assets.dispose(o.userId, o.orgId, asset.id, "2026-06-15"),
      ]);
      const after = await getAsset(asset.id);
      // Disposal tidak boleh tertimpa kembali menjadi active.
      expect(after.status).toBe("disposed");
      expect(after.disposalDate).toBe("2026-06-15");
      // Jurnal depresiasi konsisten dengan akumulasi tercatat.
      expect(await depDebitSum(o.orgId, depExpense.id)).toBe(
        after.totalDepreciated,
      );
    },
  );

  itDb("dispose idempoten-gagal: dipanggil dua kali ditolak", async () => {
    const o = await makeOrg();
    const { depExpense, accumDep } = await makeDepAccounts(
      o.userId,
      o.orgId,
      "g",
    );
    const asset2 = await assets.addAsset(o.userId, o.orgId, {
      name: `Printer ${suffix}`,
      cost: 3_600_000,
      salvageValue: 0,
      usefulLifeMonths: 36,
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
  });
});
