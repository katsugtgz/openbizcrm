import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { fiscalPeriods, journalLines, organizations, users } from "@/db/schema";

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

  // cubic P2 accounting:369 — closePeriod tidak boleh terima bulan mustahil
  // (13, 00): biarkan gagal di service, bukan sebagai raw database error.
  itDb("closePeriod menolak bulan tidak valid (00/13)", async () => {
    const owner = await makeOrg();
    await expect(
      acct.closePeriod(owner.userId, owner.orgId, "2026-13"),
    ).rejects.toThrow(/Bulan/);
    await expect(
      acct.closePeriod(owner.userId, owner.orgId, "2026-00"),
    ).rejects.toThrow(/Bulan/);
  });

  // cubic P2 accounting:444 — semua komponen balance sheet berasal dari SATU
  // snapshot: retainedEarnings konsisten dengan income statement dan
  // balance flag benar walau ada posting konkuren.
  itDb(
    "balanceSheet konsisten satu snapshot dengan incomeStatement",
    async () => {
      const owner = await makeOrg();
      const cash = await acct.createAccount(owner.userId, owner.orgId, {
        code: "1-1000",
        name: "Kas",
        type: "asset",
      });
      const sales = await acct.createAccount(owner.userId, owner.orgId, {
        code: "4-1000",
        name: "Pendapatan",
        type: "revenue",
      });
      const e = await acct.createJournalEntry(owner.userId, owner.orgId, {
        date: "2026-11-01",
        lines: [
          { accountId: cash.id, debit: 500, credit: 0 },
          { accountId: sales.id, debit: 0, credit: 500 },
        ],
      });
      await acct.postEntry(owner.userId, owner.orgId, e.entry.id);
      const bs = await acct.balanceSheet(owner.orgId);
      const is = await acct.incomeStatement(owner.orgId);
      expect(bs.retainedEarnings).toBe(is.netIncome);
      expect(bs.retainedEarnings).toBe(500);
      expect(bs.balanced).toBe(true);
    },
  );

  // cubic pr8 schema:813 — baris jurnal org A tidak boleh mengaitkan akun
  // org B (cross-tenant). Service menolak; DB FK komposit memblokir lapisan
  // terakhir meski writer lupa validasi.
  itDb("journalLine menolak akun lintas org (service + FK)", async () => {
    const oA = await makeOrg();
    const oB = await makeOrg();
    const cashA = await acct.createAccount(oA.userId, oA.orgId, {
      code: "1-1000",
      name: "Kas A",
      type: "asset",
    });
    const salesA = await acct.createAccount(oA.userId, oA.orgId, {
      code: "4-1000",
      name: "Pendapatan A",
      type: "revenue",
    });
    const cashB = await acct.createAccount(oB.userId, oB.orgId, {
      code: "1-1000",
      name: "Kas B",
      type: "asset",
    });
    // Service: akun org B ditolak pada entry org A.
    await expect(
      acct.createJournalEntry(oA.userId, oA.orgId, {
        date: "2026-11-01",
        lines: [
          { accountId: cashB.id, debit: 10, credit: 0 },
          { accountId: salesA.id, debit: 0, credit: 10 },
        ],
      }),
    ).rejects.toThrow(/tidak ditemukan/);
    // DB layer: tulis langsung (melewati service) -> FK komposit komposit
    // (entry_id -> journal_entries(org_id,id) dan account_id ->
    // accounts(org_id,id)) harus menolak.
    const e = await acct.createJournalEntry(oA.userId, oA.orgId, {
      date: "2026-11-01",
      lines: [
        { accountId: cashA.id, debit: 10, credit: 0 },
        { accountId: salesA.id, debit: 0, credit: 10 },
      ],
    });
    await expect(
      db.insert(journalLines).values({
        orgId: oA.orgId,
        entryId: e.entry.id,
        accountId: cashB.id, // akun org B pada entry org A
        debit: 1,
        credit: 0,
      }),
    ).rejects.toThrow();
  });

  // cubic pr8 schema:826/:902 — journalEntryId pada invoices/pos_sales/
  // invoice_payments wajib FK ke journal_entries(org) (cascade), tidak ada
  // dangling reference lintas org.
  itDb(
    "journalEntryId links: FK komposit mencegah dangling/cross-org",
    async () => {
      const { posSales, invoices, invoicePayments } =
        await import("@/db/schema");
      const o = await makeOrg();
      const cash = await acct.createAccount(o.userId, o.orgId, {
        code: "1-1000",
        name: "Kas",
        type: "asset",
      });
      const sales = await acct.createAccount(o.userId, o.orgId, {
        code: "4-1000",
        name: "Pendapatan",
        type: "revenue",
      });
      const e = await acct.createJournalEntry(o.userId, o.orgId, {
        date: "2026-11-01",
        lines: [
          { accountId: cash.id, debit: 5, credit: 0 },
          { accountId: sales.id, debit: 0, credit: 5 },
        ],
      });
      // pos_sales: FK valid diterima; dangling UUID ditolak DB.
      const [sale] = await db
        .insert(posSales)
        .values({
          orgId: o.orgId,
          saleNumber: "SLS-FK-1",
          saleDate: "2026-11-01",
          paymentMethod: "cash",
          taxPct: 0,
          subtotal: 5,
          taxAmount: 0,
          total: 5,
          journalEntryId: e.entry.id,
        })
        .returning();
      expect(sale.journalEntryId).toBe(e.entry.id);
      await expect(
        db.insert(posSales).values({
          orgId: o.orgId,
          saleNumber: "SLS-FK-2",
          saleDate: "2026-11-01",
          paymentMethod: "cash",
          taxPct: 0,
          subtotal: 1,
          taxAmount: 0,
          total: 1,
          journalEntryId: "00000000-0000-0000-0000-000000000000",
        }),
      ).rejects.toThrow();
      // Cross-org journal ditolak: jurnal milik org lain.
      const oB = await makeOrg();
      await expect(
        db.insert(posSales).values({
          orgId: oB.orgId,
          saleNumber: "SLS-FK-B",
          saleDate: "2026-11-01",
          paymentMethod: "cash",
          taxPct: 0,
          subtotal: 1,
          taxAmount: 0,
          total: 1,
          journalEntryId: e.entry.id, // jurnal org pertama
        }),
      ).rejects.toThrow();
      void invoices;
      void invoicePayments;
    },
  );

  // cubic pr8 schema:826 — (debit,credit)=(0,0) ditolak DB-level.
  itDb("journalLines CHECK menolak (0,0)", async () => {
    const o = await makeOrg();
    const cash = await acct.createAccount(o.userId, o.orgId, {
      code: "1-1000",
      name: "Kas",
      type: "asset",
    });
    const sales = await acct.createAccount(o.userId, o.orgId, {
      code: "4-1000",
      name: "Pendapatan",
      type: "revenue",
    });
    const e = await acct.createJournalEntry(o.userId, o.orgId, {
      date: "2026-11-01",
      lines: [
        { accountId: cash.id, debit: 5, credit: 0 },
        { accountId: sales.id, debit: 0, credit: 5 },
      ],
    });
    await expect(
      db.insert(journalLines).values({
        orgId: o.orgId,
        entryId: e.entry.id,
        accountId: cash.id,
        debit: 0,
        credit: 0,
      }),
    ).rejects.toThrow(); // drizzle bungkus error PG (cause) — cukup tolak
  });
});
