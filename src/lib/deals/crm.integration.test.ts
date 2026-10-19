import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { organizations, users } from "@/db/schema";
import { NotFoundError } from "@/lib/org-scope";

// DB-touching modules load ONLY when RUN_DB_TESTS=1 (same lazy-import pattern
// as hrm.integration.test.ts:4).
type CrmRepo = typeof import("@/lib/repos/crm-repo");
type DealsService = typeof import("@/lib/deals/service");
type QuotationMod = typeof import("@/lib/deals/quotation");

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("crm integration", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let crm!: CrmRepo;
  let deals!: DealsService;
  let calculateQuotationTotals!: QuotationMod["calculateQuotationTotals"];

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    crm = await import("@/lib/repos/crm-repo");
    deals = await import("@/lib/deals/service");
    ({ calculateQuotationTotals } = await import("@/lib/deals/quotation"));
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

  itDb(
    "company + contact + deal roundtrip, moveDeal, quotation, org isolation",
    async () => {
      // --- org A ---
      const ownerA = await (
        await import("@/lib/repos/user-repo")
      ).createUser({
        workosUserId: `it-crm-a-${suffix}`,
        email: `it-crm-a-${suffix}@test.id`,
      });
      createdUserIds.push(ownerA.id);
      const orgA = await (
        await import("@/lib/repos/org-repo")
      ).createOrg({ name: "CRM Org A", slug: `it-crm-a-${suffix}` }, ownerA.id);
      createdOrgIds.push(orgA.id);

      const company = await crm.createCompany(ownerA.id, orgA.id, {
        name: `PT Uji ${suffix}`,
        industry: "Manufaktur",
      });
      expect(company.name).toBe(`PT Uji ${suffix}`);

      const contact = await crm.createContact(ownerA.id, orgA.id, {
        companyId: company.id,
        name: "Budi Kontak",
        email: "budi@uji.id",
      });

      const { pipeline, stages } = await crm.getOrCreateDefaultPipeline(
        orgA.id,
        company.id,
      );
      expect(stages.map((s) => s.name)).toEqual([
        "Leads Baru",
        "Sudah Dihubungi",
        "Dijadwalkan Meeting",
        "Quotation Dikirim",
        "Close Won",
        "Close Lost",
      ]);

      const deal = await crm.createDeal(ownerA.id, orgA.id, {
        pipelineId: pipeline.id,
        stageId: stages[0].id,
        companyId: company.id,
        contactId: contact.id,
        title: "Deal Uji",
        value: 5_000_000,
      });
      expect(deal.status).toBe("open");
      expect(deal.quotationStatus).toBe("draft");

      // --- moveDeal: Leads Baru -> Quotation Dikirim (tetap open) ---
      const moved = await crm.moveDeal(
        ownerA.id,
        orgA.id,
        deal.id,
        stages[3].id,
      );
      expect(moved.stageId).toBe(stages[3].id);
      expect(moved.status).toBe("open");
      expect(moved.closedAt).toBeNull();

      // --- moveDeal stage transition won ---
      const won = await crm.moveDeal(ownerA.id, orgA.id, deal.id, stages[4].id);
      expect(won.status).toBe("won");
      expect(won.closedAt).not.toBeNull();

      // --- quotation: status flow + total ---
      const sent = await deals.setQuotationStatus(
        ownerA.id,
        orgA.id,
        deal.id,
        "sent",
      );
      expect(sent.quotationStatus).toBe("sent");
      const accepted = await deals.setQuotationStatus(
        ownerA.id,
        orgA.id,
        deal.id,
        "accepted",
      );
      expect(accepted.quotationStatus).toBe("accepted");
      // transisi ilegal ditolak
      await expect(
        deals.setQuotationStatus(ownerA.id, orgA.id, deal.id, "sent"),
      ).rejects.toThrow(/tidak valid/);
      expect(
        calculateQuotationTotals([
          {
            description: "Lisensi",
            quantity: 2,
            unitPrice: 2_500_000,
            discountPercent: 10,
          },
        ]),
      ).toEqual({
        subtotal: 5_000_000,
        discountTotal: 500_000,
        total: 4_500_000,
      });

      // --- activity ---
      const act = await crm.createActivity(ownerA.id, orgA.id, {
        dealId: deal.id,
        type: "call",
        content: "Telepon perdana",
      });
      const acts = await crm.listActivities(orgA.id, deal.id);
      expect(acts.map((a) => a.id)).toContain(act.id);

      // --- org isolation: org B tidak bisa baca deal org A ---
      const ownerB = await (
        await import("@/lib/repos/user-repo")
      ).createUser({
        workosUserId: `it-crm-b-${suffix}`,
        email: `it-crm-b-${suffix}@test.id`,
      });
      createdUserIds.push(ownerB.id);
      const orgB = await (
        await import("@/lib/repos/org-repo")
      ).createOrg({ name: "CRM Org B", slug: `it-crm-b-${suffix}` }, ownerB.id);
      createdOrgIds.push(orgB.id);

      expect(await crm.getDeal(orgB.id, deal.id)).toBeNull();
      expect(await crm.listDeals(orgB.id)).toHaveLength(0);
      expect(await crm.getCompany(orgB.id, company.id)).toBeNull();
      await expect(crm.listActivities(orgB.id, deal.id)).rejects.toThrow(
        NotFoundError,
      );
      await expect(
        crm.moveDeal(ownerB.id, orgB.id, deal.id, stages[0].id),
      ).rejects.toThrow(NotFoundError);
      await expect(
        deals.closeDeal(ownerB.id, orgB.id, deal.id, "lost"),
      ).rejects.toThrow(NotFoundError);
      await expect(
        deals.setQuotationStatus(ownerB.id, orgB.id, deal.id, "sent"),
      ).rejects.toThrow(NotFoundError);
      await expect(
        crm.createActivity(ownerB.id, orgB.id, {
          dealId: deal.id,
          type: "note",
          content: "coba cross-org",
        }),
      ).rejects.toThrow(NotFoundError);
    },
  );

  itDb("closeDeal menolak outcome tidak valid & idempoten", async () => {
    // Org + deal kecil terpisah untuk pin perilaku closeDeal (cubic P2
    // service:50/53) dan transisi quotation konkuren (cubic P2 service:92).
    const owner = await (
      await import("@/lib/repos/user-repo")
    ).createUser({
      workosUserId: `it-close-${suffix}`,
      email: `it-close-${suffix}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await (
      await import("@/lib/repos/org-repo")
    ).createOrg(
      { name: "CRM Close Org", slug: `it-close-${suffix}` },
      owner.id,
    );
    createdOrgIds.push(org.id);

    const company = await crm.createCompany(owner.id, org.id, {
      name: `PT Close ${suffix}`,
    });
    const contact = await crm.createContact(owner.id, org.id, {
      companyId: company.id,
      name: "Kontak Close",
    });
    const { pipeline, stages } = await crm.getOrCreateDefaultPipeline(
      org.id,
      company.id,
    );
    const deal = await crm.createDeal(owner.id, org.id, {
      pipelineId: pipeline.id,
      stageId: stages[0].id,
      companyId: company.id,
      contactId: contact.id,
      title: "Deal Close",
      value: 1_000_000,
    });

    // outcome di luar won/lost ditolak sebelum menyentuh DB.
    await expect(
      deals.closeDeal(owner.id, org.id, deal.id, "open" as "won"),
    ).rejects.toThrow(/won|lost/);

    // close pertama menang; close kedua idempoten, tidak menimpa outcome.
    const won = await deals.closeDeal(owner.id, org.id, deal.id, "won");
    expect(won.status).toBe("won");
    const again = await deals.closeDeal(owner.id, org.id, deal.id, "lost");
    expect(again.status).toBe("won");
    expect(again.stageId).toBe(won.stageId);

    // Transisi quotation valid lalu double-call sekuensial: panggilan kedua
    // dari status yang sama harus gagal (guard WHERE quotationStatus).
    await deals.setQuotationStatus(owner.id, org.id, deal.id, "sent");
    await expect(
      deals.setQuotationStatus(owner.id, org.id, deal.id, "sent"),
    ).rejects.toThrow(/tidak valid/);
  });

  itDb("createDeal dari stage Close Won langsung -> status won", async () => {
    // Pin cubic P2 crm-repo:329.
    const owner = await (
      await import("@/lib/repos/user-repo")
    ).createUser({
      workosUserId: `it-direct-${suffix}`,
      email: `it-direct-${suffix}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await (
      await import("@/lib/repos/org-repo")
    ).createOrg(
      { name: "CRM Direct Org", slug: `it-direct-${suffix}` },
      owner.id,
    );
    createdOrgIds.push(org.id);
    const company = await crm.createCompany(owner.id, org.id, {
      name: `PT Direct ${suffix}`,
    });
    const { pipeline, stages } = await crm.getOrCreateDefaultPipeline(
      org.id,
      company.id,
    );
    const closeWon = stages.find((s) => s.name === "Close Won")!;
    const deal = await crm.createDeal(owner.id, org.id, {
      pipelineId: pipeline.id,
      stageId: closeWon.id,
      companyId: company.id,
      title: "Deal Langsung Won",
      value: 2_000_000,
    });
    expect(deal.status).toBe("won");
    expect(deal.closedAt).not.toBeNull();
  });
});
