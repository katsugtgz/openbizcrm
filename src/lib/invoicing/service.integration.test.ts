import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  accounts,
  journalEntries,
  journalLines,
  organizations,
  users,
} from "@/db/schema";

type Svc = typeof import("@/lib/invoicing/service");
type AcctSvc = typeof import("@/lib/accounting/service");

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

/** Kode akun PPN keluaran (liability), auto-create per org (P1 invoicing:312). */
const PPN_OUT_CODE = "2-2000";

describe("invoicing integration", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let svc!: Svc;
  let acct!: AcctSvc;

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    svc = await import("@/lib/invoicing/service");
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
      workosUserId: `it-inv-${suffix}-${createdUserIds.length}`,
      email: `it-inv-${suffix}-${createdUserIds.length}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await (
      await import("@/lib/repos/org-repo")
    ).createOrg(
      {
        name: `Inv Org ${suffix}`,
        slug: `it-inv-${suffix}-${createdOrgIds.length}`,
      },
      owner.id,
    );
    createdOrgIds.push(org.id);
    return { userId: owner.id, orgId: org.id };
  }

  async function seedAccounts(o: { userId: string; orgId: string }) {
    const cash = await acct.createAccount(o.userId, o.orgId, {
      code: "1-1000",
      name: "Kas",
      type: "asset",
    });
    const bank = await acct.createAccount(o.userId, o.orgId, {
      code: "1-1100",
      name: "Bank",
      type: "asset",
    });
    const ar = await acct.createAccount(o.userId, o.orgId, {
      code: "1-1300",
      name: "Piutang Usaha",
      type: "asset",
    });
    const revenue = await acct.createAccount(o.userId, o.orgId, {
      code: "4-1000",
      name: "Pendapatan",
      type: "revenue",
    });
    const expense = await acct.createAccount(o.userId, o.orgId, {
      code: "5-1000",
      name: "Beban",
      type: "expense",
    });
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
    return { cash, bank, ar, revenue, expense, depExpense, accumDep };
  }

  async function orgEntries(orgId: string) {
    return db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.orgId, orgId))
      .orderBy(journalEntries.entryNumber);
  }

  itDb("lifecycle draft->sent->paid: 3 balanced entries", async () => {
    const o = await makeOrg();
    const accs = await seedAccounts(o);
    const company = await (
      await import("@/lib/repos/crm-repo")
    ).createCompany(o.userId, o.orgId, { name: `PT ${suffix}` });

    // --- draft ---
    const { invoice, items } = await svc.createInvoice(o.userId, o.orgId, {
      companyId: company.id,
      issueDate: "2026-11-01",
      dueDate: "2026-12-01",
      taxPct: 11,
      items: [
        { description: "Lisensi tahunan", qty: 2, unitPrice: 1_000_000 },
        { description: "Setup", qty: 1, unitPrice: 500_000 },
      ],
    });
    expect(invoice.status).toBe("draft");
    expect(invoice.subtotal).toBe(2_500_000);
    expect(invoice.taxAmount).toBe(275_000); // floor((2500000/100)*11)
    expect(invoice.total).toBe(2_775_000);
    expect(invoice.invoiceNumber).toBe("INV-001");
    expect(items).toHaveLength(2);
    expect(await orgEntries(o.orgId)).toHaveLength(0); // draft tanpa jurnal

    // --- company org-scoped: company org lain ditolak ---
    const o2 = await makeOrg();
    const companyB = await (
      await import("@/lib/repos/crm-repo")
    ).createCompany(o2.userId, o2.orgId, { name: `PT B ${suffix}` });
    await expect(
      svc.createInvoice(o.userId, o.orgId, {
        companyId: companyB.id, // org B
        issueDate: "2026-11-01",
        dueDate: "2026-12-01",
        items: [{ description: "x", qty: 1, unitPrice: 100 }],
      }),
    ).rejects.toThrow(/Perusahaan tidak ditemukan/);

    // --- sent: jurnal AR debit / revenue credit (entry 1) ---
    const sent = await svc.sendInvoice(o.userId, o.orgId, invoice.id);
    expect(sent.status).toBe("sent");
    let entries = await orgEntries(o.orgId);
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe("invoice");
    expect(entries[0].status).toBe("posted");

    // --- kirim dua kali ditolak ---
    await expect(
      svc.sendInvoice(o.userId, o.orgId, invoice.id),
    ).rejects.toThrow(/Hanya invoice draft/);

    // --- partial payment (entry 2) ---
    const { invoice: partial } = await svc.recordPayment(
      o.userId,
      o.orgId,
      invoice.id,
      {
        amount: 775_000,
        method: "cash",
        paidAt: "2026-11-05",
      },
    );
    expect(partial.status).toBe("sent"); // belum lunas
    expect(partial.paidAmount).toBe(775_000);

    // --- full payment (entry 3) -> paid ---
    const { invoice: paid } = await svc.recordPayment(
      o.userId,
      o.orgId,
      invoice.id,
      {
        amount: 2_000_000,
        method: "transfer",
        paidAt: "2026-11-10",
      },
    );
    expect(paid.status).toBe("paid");
    expect(paid.paidAmount).toBe(2_775_000);

    entries = await orgEntries(o.orgId);
    expect(entries).toHaveLength(3);
    // Semua balanced: engine validateEntry dijalankan via postJournal.
    const tb = await acct.trialBalanceService(o.orgId);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(2_775_000 * 2); // AR entry + 2 payment entries

    // PPN bukan pendapatan (cubic P1 invoicing:312): entry 1 (send) =
    // debit AR 2.775.000, credit Revenue subtotal 2.500.000, credit PPN
    // keluaran 275.000. Revenue line TIDAK gross.
    const sendLines = await db
      .select({ line: journalLines, account: accounts })
      .from(journalLines)
      .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
      .where(eq(journalLines.entryId, entries[0].id));
    const revSend = sendLines.find((r) => r.account.code === "4-1000");
    const ppnSend = sendLines.find(
      (r) => r.account.code === PPN_OUT_CODE && r.line.credit === 275_000,
    );
    expect(revSend?.line.credit).toBe(2_500_000); // subtotal, bukan gross
    expect(revSend?.line.debit).toBe(0);
    expect(ppnSend).toBeDefined();
    expect(ppnSend!.account.type).toBe("liability");
    const arSend = sendLines.find(
      (r) => r.account.code === "1-1300" && r.line.debit === 2_775_000,
    );
    expect(arSend).toBeDefined();

    // --- overpayment ditolak (invoice sudah paid) ---
    await expect(
      svc.recordPayment(o.userId, o.orgId, invoice.id, {
        amount: 1,
        method: "qris",
        paidAt: "2026-11-11",
      }),
    ).rejects.toThrow(/tidak bisa dibayar/);
    void accs;
  });

  itDb("overpayment pada invoice sent ditolak sebelum mutasi", async () => {
    const o = await makeOrg();
    await seedAccounts(o);
    const company = await (
      await import("@/lib/repos/crm-repo")
    ).createCompany(o.userId, o.orgId, { name: `PT OP ${suffix}` });
    const { invoice } = await svc.createInvoice(o.userId, o.orgId, {
      companyId: company.id,
      issueDate: "2026-11-01",
      dueDate: "2026-12-01",
      items: [{ description: "x", qty: 1, unitPrice: 100_000 }],
    });
    await svc.sendInvoice(o.userId, o.orgId, invoice.id);
    await expect(
      svc.recordPayment(o.userId, o.orgId, invoice.id, {
        amount: 100_001,
        method: "cash",
        paidAt: "2026-11-05",
      }),
    ).rejects.toThrow(/Overpayment/);
    // Tidak ada jurnal payment tambahan (hanya entry send).
    const entries = await orgEntries(o.orgId);
    expect(entries).toHaveLength(1);
  });

  itDb(
    "markOverdue: sent->overdue, paid tidak bisa; org isolation invoice",
    async () => {
      const oA = await makeOrg();
      await seedAccounts(oA);
      const oB = await makeOrg();
      await seedAccounts(oB);
      const companyA = await (
        await import("@/lib/repos/crm-repo")
      ).createCompany(oA.userId, oA.orgId, { name: `PT A ${suffix}` });

      const { invoice } = await svc.createInvoice(oA.userId, oA.orgId, {
        companyId: companyA.id,
        issueDate: "2026-01-01",
        dueDate: "2026-01-15", // past — markOverdue kini wajib dueDate <= today
        items: [{ description: "x", qty: 1, unitPrice: 50_000 }],
      });
      await svc.sendInvoice(oA.userId, oA.orgId, invoice.id);
      const overdue = await svc.markOverdue(oA.userId, oA.orgId, invoice.id);
      expect(overdue.status).toBe("overdue");
      // Idempoten utk overdue (balik objek sama, tanpa error).
      const again = await svc.markOverdue(oA.userId, oA.orgId, invoice.id);
      expect(again.status).toBe("overdue");

      // org B tak bisa membaca/mutasi invoice org A
      await expect(
        svc.sendInvoice(oB.userId, oB.orgId, invoice.id),
      ).rejects.toThrow(/tidak ditemukan/);
      await expect(
        svc.recordPayment(oB.userId, oB.orgId, invoice.id, {
          amount: 50_000,
          method: "cash",
          paidAt: "2026-11-16",
        }),
      ).rejects.toThrow(/tidak ditemukan/);

      // Invoice org B bernomor 1 juga (isolasi numbering).
      const companyB = await (
        await import("@/lib/repos/crm-repo")
      ).createCompany(oB.userId, oB.orgId, { name: `PT B2 ${suffix}` });
      const { invoice: invB } = await svc.createInvoice(oB.userId, oB.orgId, {
        companyId: companyB.id,
        issueDate: "2026-11-01",
        dueDate: "2026-12-01",
        items: [{ description: "y", qty: 1, unitPrice: 10 }],
      });
      expect(invB.invoiceNumber).toBe("INV-001");
    },
  );

  // cubic P2 invoicing:446: future-due invoice TIDAK boleh jadi overdue —
  // transisi wajib cek dueDate <= CURRENT_DATE, bukan status saja.
  itDb("markOverdue menolak invoice yang belum jatuh tempo", async () => {
    const o = await makeOrg();
    await seedAccounts(o);
    const company = await (
      await import("@/lib/repos/crm-repo")
    ).createCompany(o.userId, o.orgId, { name: `PT Future ${suffix}` });
    const { invoice } = await svc.createInvoice(o.userId, o.orgId, {
      companyId: company.id,
      issueDate: "2020-01-01",
      dueDate: "2099-12-31", // jauh di masa depan
      items: [{ description: "x", qty: 1, unitPrice: 50_000 }],
    });
    await svc.sendInvoice(o.userId, o.orgId, invoice.id);
    await expect(
      svc.markOverdue(o.userId, o.orgId, invoice.id),
    ).rejects.toThrow(/belum jatuh tempo/);
  });

  // cubic P1 invoicing:294: invoice dan POS share the journal entryNumber
  // sequence, jadi keduanya wajib satu lock family yang sama ("acct:<orgId>",
  // sama dengan accounting postEntry) — kalau POS masih "pos:<orgId>",
  // concurrent send-invoice + checkout bisa alokasikan entryNumber sama.
  itDb(
    "POS checkout serializes with invoice under the same journal lock",
    async () => {
      const o = await makeOrg();
      await seedAccounts(o);
      const pos = await import("@/lib/pos/service");
      const product = await pos.addProduct(o.userId, o.orgId, {
        name: `Buku ${suffix}`,
        sku: `BKU-${suffix}`,
        price: 10_000,
        initialStock: 5,
      });
      const company = await (
        await import("@/lib/repos/crm-repo")
      ).createCompany(o.userId, o.orgId, { name: `PT Lock ${suffix}` });
      const { invoice } = await svc.createInvoice(o.userId, o.orgId, {
        companyId: company.id,
        issueDate: "2026-11-01",
        dueDate: "2026-12-01",
        items: [{ description: "x", qty: 1, unitPrice: 100 }],
      });

      // Jalan bareng: posting invoice + checkout POS harus serialized satu lock.
      const [sent, sale] = await Promise.all([
        svc.sendInvoice(o.userId, o.orgId, invoice.id),
        pos.checkout(o.userId, o.orgId, {
          items: [{ productId: product.id, qty: 1 }],
          paymentMethod: "cash",
          date: "2026-11-01",
        }),
      ]);
      expect(sent.status).toBe("sent");
      expect(sale.sale.saleNumber).toBe("SLS-001");

      const entries = await orgEntries(o.orgId);
      expect(entries.map((e) => e.entryNumber).sort((a, b) => a - b)).toEqual([
        1, 2,
      ]);
      const nums = entries.map((e) => e.entryNumber);
      expect(new Set(nums).size).toBe(nums.length); // tanpa tabrakan
    },
  );
});
