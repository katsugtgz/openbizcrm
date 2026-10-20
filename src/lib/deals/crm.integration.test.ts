import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { organizations, users, crmDeals as dealsTable } from "@/db/schema";
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

      // --- satu jalur close: drag/pindah ke Close Won ditolak, wajib
      // lewat closeDeal (outcome + kopling quotation + idempotensi) ---
      await expect(
        crm.moveDeal(ownerA.id, orgA.id, deal.id, stages[4].id),
      ).rejects.toThrow(/tutup deal lewat tombol/);
      await expect(
        crm.moveDeal(ownerA.id, orgA.id, deal.id, stages[5].id),
      ).rejects.toThrow(/tutup deal lewat tombol/);

      // --- won mensyaratkan quotation accepted (deal/quote terkopling) ---
      await expect(
        deals.closeDeal(ownerA.id, orgA.id, deal.id, "won"),
      ).rejects.toThrow(/accepted/);

      // --- quotation: status flow + total (di deal open) ---
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

      // --- close via satu-satunya jalur; quotation lalu membeku ---
      const won = await deals.closeDeal(ownerA.id, orgA.id, deal.id, "won");
      expect(won.status).toBe("won");
      expect(won.closedAt).not.toBeNull();
      await expect(
        deals.setQuotationStatus(ownerA.id, orgA.id, deal.id, "rejected"),
      ).rejects.toThrow(/tidak bisa diubah/);

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

    // Terima quotation dahulu agar race won-vs-lost di bawah adalah
    // perebutan tulis sungguhan (won tanpa accepted ditolak guard).
    await deals.setQuotationStatus(owner.id, org.id, deal.id, "sent");
    await deals.setQuotationStatus(owner.id, org.id, deal.id, "accepted");

    // Close konkuren won+lost (Promise.allSettled — promise rejection tidak
    // melempar): tepat satu menang, deal status = outcome pemenang. Uji race
    // protection sungguhan, bukan versi sekuensial yang selalu lolos
    // (cubic P2 crm.integration:244).
    const results = await Promise.allSettled([
      deals.closeDeal(owner.id, org.id, deal.id, "won"),
      deals.closeDeal(owner.id, org.id, deal.id, "lost"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    const winnerStatus = (ok[0] as PromiseFulfilledResult<{ status: string }>)
      .value.status;
    // Close ulang outcome sama = idempoten; outcome lain = konflik.
    const again = await deals.closeDeal(
      owner.id,
      org.id,
      deal.id,
      winnerStatus as "won",
    );
    expect(again.status).toBe(winnerStatus);
    const other = winnerStatus === "won" ? "lost" : "won";
    await expect(
      deals.closeDeal(owner.id, org.id, deal.id, other as "won"),
    ).rejects.toThrow(new RegExp(`sudah ${winnerStatus}`));

    // Transisi quotation double-call sekuensial di deal open KEDUA (deal
    // pertama sudah closed → quotation-nya beku): panggilan kedua dari
    // status yang sama harus gagal (guard WHERE quotationStatus).
    const deal2 = await crm.createDeal(owner.id, org.id, {
      pipelineId: pipeline.id,
      stageId: stages[0].id,
      companyId: company.id,
      contactId: contact.id,
      title: "Deal Close 2",
      value: 1_000_000,
    });
    await deals.setQuotationStatus(owner.id, org.id, deal2.id, "sent");
    await expect(
      deals.setQuotationStatus(owner.id, org.id, deal2.id, "sent"),
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

  itDb(
    "moveDeal on closed deal: stale queued move rejected, deal stays closed",
    async () => {
      // Pin cubic P1 deals/service:90 — closeDeal lalu moveDeal yang
      // pre-read deal open tidak boleh membuka ulang / retarget.
      const owner = await (
        await import("@/lib/repos/user-repo")
      ).createUser({
        workosUserId: `it-move-closed-${suffix}`,
        email: `it-move-closed-${suffix}@test.id`,
      });
      createdUserIds.push(owner.id);
      const org = await (
        await import("@/lib/repos/org-repo")
      ).createOrg(
        { name: "Move Closed Org", slug: `it-move-closed-${suffix}` },
        owner.id,
      );
      createdOrgIds.push(org.id);

      const company = await crm.createCompany(owner.id, org.id, {
        name: `PT MoveClosed ${suffix}`,
      });
      const contact = await crm.createContact(owner.id, org.id, {
        companyId: company.id,
        name: "Kontak MoveClosed",
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
        title: "Deal MoveClosed",
        value: 500_000,
      });
      await deals.setQuotationStatus(owner.id, org.id, deal.id, "sent");
      await deals.setQuotationStatus(owner.id, org.id, deal.id, "accepted");
      const closed = await deals.closeDeal(owner.id, org.id, deal.id, "won");

      // Simulasi move antrean yang membaca deal sebelum close: ditolak.
      const target = stages[1];
      await expect(
        crm.moveDeal(owner.id, org.id, deal.id, target.id),
      ).rejects.toThrow(/basi|sudah won/);

      // Deal tetap closed: status + stage hasil close tidak berubah.
      const [after] = await db
        .select()
        .from(dealsTable)
        .where(eq(dealsTable.id, deal.id))
        .limit(1);
      expect(after.status).toBe("won");
      expect(after.stageId).toBe(closed.stageId);
      expect(after.closedAt).not.toBeNull();
    },
  );

  itDb("update/delete deal/kontak/perusahaan + guard closed/relasi", async () => {
    const owner = await (
      await import("@/lib/repos/user-repo")
    ).createUser({
      workosUserId: `it-crud-${suffix}`,
      email: `it-crud-${suffix}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await (
      await import("@/lib/repos/org-repo")
    ).createOrg(
      { name: "CRM CRUD Org", slug: `it-crud-${suffix}` },
      owner.id,
    );
    createdOrgIds.push(org.id);

    const company = await crm.createCompany(owner.id, org.id, {
      name: `PT CRUD ${suffix}`,
    });
    // Owner default = pembuat.
    expect(company.ownerUserId).toBe(owner.id);
    const renamed = await crm.updateCompany(owner.id, org.id, company.id, {
      name: `PT CRUD Baru ${suffix}`,
    });
    expect(renamed.name).toBe(`PT CRUD Baru ${suffix}`);

    // Email/telepon tak valid ditolak; valid lolos.
    await expect(
      crm.createContact(owner.id, org.id, {
        companyId: company.id,
        name: "Jelek",
        email: "bukan-email",
      }),
    ).rejects.toThrow(/Email kontak/);
    await expect(
      crm.createContact(owner.id, org.id, {
        companyId: company.id,
        name: "Jelek",
        phone: "12",
      }),
    ).rejects.toThrow(/telepon/);
    const contact = await crm.createContact(owner.id, org.id, {
      companyId: company.id,
      name: "Kontak CRUD",
      email: "crud@uji.id",
      phone: "08123456789",
    });
    const contact2 = await crm.createContact(owner.id, org.id, {
      companyId: company.id,
      name: "Kontak Hapus",
    });
    const updContact = await crm.updateContact(owner.id, org.id, contact.id, {
      position: "Direktur",
    });
    expect(updContact.position).toBe("Direktur");
    await crm.deleteContact(owner.id, org.id, contact2.id);
    await expect(
      crm.deleteContact(owner.id, org.id, contact2.id),
    ).rejects.toThrow(/tidak ditemukan/);

    const { pipeline, stages } = await crm.getOrCreateDefaultPipeline(
      org.id,
      company.id,
      { userId: owner.id },
    );
    // Pembuatan pipeline diaudit.
    const { auditLogs } = await import("@/db/schema");
    const pipeAudits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, pipeline.id));
    expect(pipeAudits.map((a) => a.action)).toContain("crm.pipeline.create");

    const deal = await crm.createDeal(owner.id, org.id, {
      pipelineId: pipeline.id,
      stageId: stages[0].id,
      companyId: company.id,
      contactId: contact.id,
      title: "Deal CRUD",
      value: 1_000_000,
    });
    const updDeal = await crm.updateDeal(owner.id, org.id, deal.id, {
      title: "Deal CRUD Revisi",
      value: 2_000_000,
    });
    expect(updDeal.title).toBe("Deal CRUD Revisi");
    expect(updDeal.value).toBe(2_000_000);

    // Perusahaan ber-deal tak bisa dihapus.
    await expect(
      crm.deleteCompany(owner.id, org.id, company.id),
    ).rejects.toThrow(/masih memiliki deal/);

    // Close (lost bebas quotation) lalu deal membeku: update/delete ditolak.
    await deals.setQuotationStatus(owner.id, org.id, deal.id, "sent");
    await deals.closeDeal(owner.id, org.id, deal.id, "lost");
    await expect(
      crm.updateDeal(owner.id, org.id, deal.id, { title: "Ubah Histori" }),
    ).rejects.toThrow(/tidak bisa diubah/);
    await expect(
      crm.deleteDeal(owner.id, org.id, deal.id),
    ).rejects.toThrow(/tidak bisa dihapus/);

    // Deal open lain bisa dihapus; lalu perusahaan kosong bisa dihapus.
    // (Deal lost di atas masih menghalangi — pin guard-nya, lalu selesai.)
    const dealOpen = await crm.createDeal(owner.id, org.id, {
      pipelineId: pipeline.id,
      stageId: stages[0].id,
      companyId: company.id,
      title: "Deal Sementara",
      value: 10_000,
    });
    await crm.deleteDeal(owner.id, org.id, dealOpen.id);
    expect(await crm.getDeal(org.id, dealOpen.id)).toBeNull();
    await expect(
      crm.deleteCompany(owner.id, org.id, company.id),
    ).rejects.toThrow(/masih memiliki deal/);
  });

  itDb("createDeal menolak kontak dari company lain (org sama)", async () => {
    const owner = await (
      await import("@/lib/repos/user-repo")
    ).createUser({
      workosUserId: `it-xcontact-${suffix}`,
      email: `it-xcontact-${suffix}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await (
      await import("@/lib/repos/org-repo")
    ).createOrg(
      { name: "CRM Cross Org", slug: `it-xcontact-${suffix}` },
      owner.id,
    );
    createdOrgIds.push(org.id);
    const companyA = await crm.createCompany(owner.id, org.id, {
      name: `PT XA ${suffix}`,
    });
    const companyB = await crm.createCompany(owner.id, org.id, {
      name: `PT XB ${suffix}`,
    });
    const contactB = await crm.createContact(owner.id, org.id, {
      companyId: companyB.id,
      name: "Kontak B",
    });
    const { pipeline, stages } = await crm.getOrCreateDefaultPipeline(
      org.id,
      companyA.id,
    );
    await expect(
      crm.createDeal(owner.id, org.id, {
        pipelineId: pipeline.id,
        stageId: stages[0].id,
        companyId: companyA.id,
        contactId: contactB.id,
        title: "Deal Kontak Silang",
        value: 1,
      }),
    ).rejects.toThrow(/Kontak tidak ditemukan/);
  });
});
