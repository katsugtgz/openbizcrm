import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  crmActivities,
  crmCompanies,
  crmContacts,
  crmDeals,
  crmPipelines,
  crmStages,
  invoices,
  orgMemberships,
} from "@/db/schema";
import { NotFoundError, requireOrgRole } from "@/lib/org-scope";
import { assertSafeAmount } from "@/lib/money";
import { recordAudit } from "@/lib/repos/audit-repo";

export type CrmCompany = typeof crmCompanies.$inferSelect;
export type CrmContact = typeof crmContacts.$inferSelect;
export type CrmPipeline = typeof crmPipelines.$inferSelect;
export type CrmStage = typeof crmStages.$inferSelect;
export type CrmDeal = typeof crmDeals.$inferSelect;
export type CrmActivity = typeof crmActivities.$inferSelect;

/** Tahap default pipeline per-company (sesuai spesifikasi CRM). */
export const DEFAULT_STAGE_NAMES = [
  "Leads Baru",
  "Sudah Dihubungi",
  "Dijadwalkan Meeting",
  "Quotation Dikirim",
  "Close Won",
  "Close Lost",
] as const;

/** Tenant guard: entity milik org lain => NotFoundError (target tak terlihat). */
async function requireDeal(orgId: string, dealId: string): Promise<CrmDeal> {
  const [deal] = await db
    .select()
    .from(crmDeals)
    .where(and(eq(crmDeals.id, dealId), eq(crmDeals.orgId, orgId)))
    .limit(1);
  if (!deal) {
    throw new NotFoundError("Deal tidak ditemukan.");
  }
  return deal;
}

/** User wajib anggota org ini (dipakai untuk owner/assignee lintas repos). */
export async function requireOrgMember(
  orgId: string,
  userId: string,
  label = "Pengguna",
): Promise<void> {
  const [m] = await db
    .select({ id: orgMemberships.id })
    .from(orgMemberships)
    .where(
      and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
    )
    .limit(1);
  if (!m) throw new NotFoundError(`${label} bukan anggota organisasi ini.`);
}

/** Email kontak: bentuk user@domain.tld tanpa spasi. */
export function assertContactEmail(email: string | null): void {
  if (email === null) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Email kontak tidak valid.");
  }
}

/** Telepon kontak: digit/+/spasi/tanda baca umum, 7..15 digit. */
export function assertContactPhone(phone: string | null): void {
  if (phone === null) return;
  const digits = phone.replace(/\D/g, "");
  if (
    !/^[+\d][\d\s\-().]*$/.test(phone) ||
    digits.length < 7 ||
    digits.length > 15
  ) {
    throw new Error("Nomor telepon kontak tidak valid.");
  }
}

// ---------------- Companies ----------------

export async function listCompanies(
  orgId: string,
  limit = 500,
): Promise<CrmCompany[]> {
  return db
    .select()
    .from(crmCompanies)
    .where(eq(crmCompanies.orgId, orgId))
    .orderBy(asc(crmCompanies.name))
    .limit(limit);
}

export async function getCompany(
  orgId: string,
  id: string,
): Promise<CrmCompany | null> {
  const [row] = await db
    .select()
    .from(crmCompanies)
    .where(and(eq(crmCompanies.id, id), eq(crmCompanies.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function createCompany(
  userId: string,
  orgId: string,
  input: {
    name: string;
    industry?: string | null;
    ownerUserId?: string | null;
  },
): Promise<CrmCompany> {
  await requireOrgRole(userId, orgId, "member");
  // Kolom owner hidup: default pembuat (UI tak punya pemilih owner), nilai
  // eksplisit wajib anggota org ini.
  const ownerUserId = input.ownerUserId ?? userId;
  await requireOrgMember(orgId, ownerUserId, "Pemilik perusahaan");
  const [row] = await db
    .insert(crmCompanies)
    .values({
      orgId,
      name: input.name,
      industry: input.industry ?? null,
      ownerUserId,
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "crm.company.create",
    entity: "crm_company",
    entityId: row.id,
  });
  return row;
}

export async function updateCompany(
  userId: string,
  orgId: string,
  id: string,
  input: Partial<{
    name: string;
    industry: string | null;
    ownerUserId: string | null;
  }>,
): Promise<CrmCompany> {
  await requireOrgRole(userId, orgId, "member");
  await requireOrgCompany(orgId, id);
  if (input.ownerUserId) {
    await requireOrgMember(orgId, input.ownerUserId, "Pemilik perusahaan");
  }
  const [row] = await db
    .update(crmCompanies)
    .set(input)
    .where(and(eq(crmCompanies.id, id), eq(crmCompanies.orgId, orgId)))
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "crm.company.update",
    entity: "crm_company",
    entityId: id,
    metadata: input as Record<string, unknown>,
  });
  return row;
}

/**
 * Hapus perusahaan. Admin saja. Ditolak bila masih ada deal atau invoice
 * (invoice me-restrict di DB; cek di sini agar pesan jelas, bukan error PG
 * mentah). Kontak + pipeline ikut cascade FK; deal kosong = aman.
 */
export async function deleteCompany(
  userId: string,
  orgId: string,
  id: string,
): Promise<void> {
  await requireOrgRole(userId, orgId, "admin");
  await requireOrgCompany(orgId, id);
  const [deal] = await db
    .select({ id: crmDeals.id })
    .from(crmDeals)
    .where(and(eq(crmDeals.companyId, id), eq(crmDeals.orgId, orgId)))
    .limit(1);
  if (deal) {
    throw new Error(
      "Perusahaan masih memiliki deal; hapus deal-nya dahulu.",
    );
  }
  const [inv] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.companyId, id), eq(invoices.orgId, orgId)))
    .limit(1);
  if (inv) {
    throw new Error(
      "Perusahaan masih memiliki invoice; tidak bisa dihapus.",
    );
  }
  await db
    .delete(crmCompanies)
    .where(and(eq(crmCompanies.id, id), eq(crmCompanies.orgId, orgId)));
  await recordAudit({
    orgId,
    userId,
    action: "crm.company.delete",
    entity: "crm_company",
    entityId: id,
  });
}

/** Company wajib milik org ini; dipakai lintas repos (deal, proyek). */
export async function requireOrgCompany(
  orgId: string,
  id: string,
): Promise<void> {
  const [row] = await db
    .select({ id: crmCompanies.id })
    .from(crmCompanies)
    .where(and(eq(crmCompanies.id, id), eq(crmCompanies.orgId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError("Perusahaan tidak ditemukan.");
}

// ---------------- Contacts ----------------

export async function listContacts(
  orgId: string,
  companyId?: string,
  limit = 500,
): Promise<CrmContact[]> {
  const conds = [eq(crmContacts.orgId, orgId)];
  if (companyId) conds.push(eq(crmContacts.companyId, companyId));
  return db
    .select()
    .from(crmContacts)
    .where(and(...conds))
    .orderBy(asc(crmContacts.name))
    .limit(limit);
}

export async function createContact(
  userId: string,
  orgId: string,
  input: {
    companyId: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    position?: string | null;
  },
): Promise<CrmContact> {
  await requireOrgRole(userId, orgId, "member");
  await requireOrgCompany(orgId, input.companyId);
  assertContactEmail(input.email ?? null);
  assertContactPhone(input.phone ?? null);
  const [row] = await db
    .insert(crmContacts)
    .values({
      orgId,
      companyId: input.companyId,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      position: input.position ?? null,
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "crm.contact.create",
    entity: "crm_contact",
    entityId: row.id,
  });
  return row;
}

export async function updateContact(
  userId: string,
  orgId: string,
  id: string,
  input: Partial<{
    name: string;
    email: string | null;
    phone: string | null;
    position: string | null;
  }>,
): Promise<CrmContact> {
  await requireOrgRole(userId, orgId, "member");
  if (input.email !== undefined) assertContactEmail(input.email);
  if (input.phone !== undefined) assertContactPhone(input.phone);
  const [row] = await db
    .update(crmContacts)
    .set(input)
    .where(and(eq(crmContacts.id, id), eq(crmContacts.orgId, orgId)))
    .returning();
  if (!row) throw new NotFoundError("Kontak tidak ditemukan.");
  await recordAudit({
    orgId,
    userId,
    action: "crm.contact.update",
    entity: "crm_contact",
    entityId: id,
    metadata: input as Record<string, unknown>,
  });
  return row;
}

/**
 * Hapus kontak. Deal/invoice yang menaut ikut SET NULL di DB (bukan hapus
 * diam-diam) — aman tanpa guard tambahan.
 */
export async function deleteContact(
  userId: string,
  orgId: string,
  id: string,
): Promise<void> {
  await requireOrgRole(userId, orgId, "member");
  const [row] = await db
    .delete(crmContacts)
    .where(and(eq(crmContacts.id, id), eq(crmContacts.orgId, orgId)))
    .returning();
  if (!row) throw new NotFoundError("Kontak tidak ditemukan.");
  await recordAudit({
    orgId,
    userId,
    action: "crm.contact.delete",
    entity: "crm_contact",
    entityId: id,
  });
}

// ---------------- Pipeline / stages ----------------

/**
 * Pipeline + 6 tahap default per company. Idempotent: pipeline unik per
 * (org, company, name); tahap unik per (pipeline, position).
 * Pembuatan aktual diaudit (bukan re-read) bila opts.userId diisi.
 */
export async function getOrCreateDefaultPipeline(
  orgId: string,
  companyId: string,
  opts?: { userId?: string },
): Promise<{ pipeline: CrmPipeline; stages: CrmStage[] }> {
  await requireOrgCompany(orgId, companyId);
  let pipelineCreated = false;
  let [pipeline] = await db
    .select()
    .from(crmPipelines)
    .where(
      and(
        eq(crmPipelines.orgId, orgId),
        eq(crmPipelines.companyId, companyId),
        eq(crmPipelines.name, "Pipeline"),
      ),
    )
    .limit(1);
  if (!pipeline) {
    [pipeline] = await db
      .insert(crmPipelines)
      .values({ orgId, companyId, name: "Pipeline" })
      .onConflictDoNothing()
      .returning();
    if (!pipeline) {
      [pipeline] = await db
        .select()
        .from(crmPipelines)
        .where(
          and(
            eq(crmPipelines.orgId, orgId),
            eq(crmPipelines.companyId, companyId),
            eq(crmPipelines.name, "Pipeline"),
          ),
        )
        .limit(1);
    } else {
      pipelineCreated = true;
    }
  }
  let stages = await db
    .select()
    .from(crmStages)
    .where(eq(crmStages.pipelineId, pipeline.id))
    .orderBy(asc(crmStages.position));
  let stagesCreated = false;
  if (stages.length === 0) {
    await db
      .insert(crmStages)
      .values(
        DEFAULT_STAGE_NAMES.map((name, position) => ({
          orgId,
          pipelineId: pipeline.id,
          name,
          position,
        })),
      )
      .onConflictDoNothing();
    stages = await db
      .select()
      .from(crmStages)
      .where(eq(crmStages.pipelineId, pipeline.id))
      .orderBy(asc(crmStages.position));
    stagesCreated = true;
  }
  if (opts?.userId && (pipelineCreated || stagesCreated)) {
    await recordAudit({
      orgId,
      userId: opts.userId,
      action: "crm.pipeline.create",
      entity: "crm_pipeline",
      entityId: pipeline.id,
      metadata: { companyId, pipelineCreated, stagesCreated },
    });
  }
  return { pipeline, stages };
}

export async function listStages(
  orgId: string,
  pipelineId: string,
): Promise<CrmStage[]> {
  return db
    .select()
    .from(crmStages)
    .where(
      and(eq(crmStages.orgId, orgId), eq(crmStages.pipelineId, pipelineId)),
    )
    .orderBy(asc(crmStages.position));
}

// ---------------- Deals ----------------

export interface DealInput {
  pipelineId: string;
  stageId: string;
  companyId: string;
  contactId?: string | null;
  title: string;
  value: number;
}

export async function listDeals(
  orgId: string,
  pipelineId?: string,
  limit = 500,
): Promise<CrmDeal[]> {
  const conds = [eq(crmDeals.orgId, orgId)];
  if (pipelineId) conds.push(eq(crmDeals.pipelineId, pipelineId));
  return db
    .select()
    .from(crmDeals)
    .where(and(...conds))
    .orderBy(desc(crmDeals.createdAt))
    .limit(limit);
}

export async function getDeal(
  orgId: string,
  id: string,
): Promise<CrmDeal | null> {
  const [row] = await db
    .select()
    .from(crmDeals)
    .where(and(eq(crmDeals.id, id), eq(crmDeals.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function createDeal(
  userId: string,
  orgId: string,
  input: DealInput,
): Promise<CrmDeal> {
  await requireOrgRole(userId, orgId, "member");
  assertSafeAmount(input.value, "Nilai deal");
  // Pipeline, stage, company, kontak harus milik org yang sama (cubic P1
  // crm-repo:324) — stage juga harus milik pipeline yang dikirim.
  const [pipeline] = await db
    .select({ id: crmPipelines.id })
    .from(crmPipelines)
    .where(
      and(
        eq(crmPipelines.id, input.pipelineId),
        eq(crmPipelines.orgId, orgId),
        eq(crmPipelines.companyId, input.companyId),
      ),
    )
    .limit(1);
  if (!pipeline) throw new NotFoundError("Pipeline tidak ditemukan.");
  const [stage] = await db
    .select({
      id: crmStages.id,
      name: crmStages.name,
      pipelineId: crmStages.pipelineId,
    })
    .from(crmStages)
    .where(and(eq(crmStages.id, input.stageId), eq(crmStages.orgId, orgId)))
    .limit(1);
  if (!stage || stage.pipelineId !== input.pipelineId) {
    throw new NotFoundError("Stage tidak ditemukan.");
  }
  await requireOrgCompany(orgId, input.companyId);
  if (input.contactId) {
    const [contact] = await db
      .select({ id: crmContacts.id })
      .from(crmContacts)
      .where(
        and(
          eq(crmContacts.id, input.contactId),
          eq(crmContacts.orgId, orgId),
          // Kontak harus milik company deal — bukan sekadar org yang sama
          // (cubic P2 crm-repo:302).
          eq(crmContacts.companyId, input.companyId),
        ),
      )
      .limit(1);
    if (!contact) throw new NotFoundError("Kontak tidak ditemukan.");
  }
  const [row] = await db
    .insert(crmDeals)
    .values({
      orgId,
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      companyId: input.companyId,
      contactId: input.contactId ?? null,
      title: input.title,
      value: input.value,
      // status/closedAt mengikuti stage awal — deal yang dibuat langsung di
      // Close Won/Lost tidak tertinggal sebagai open (cubic P2 crm-repo:329).
      status: stageOutcome(stage.name),
      closedAt: stageOutcome(stage.name) === "open" ? null : new Date(),
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "crm.deal.create",
    entity: "crm_deal",
    entityId: row.id,
    metadata: { title: row.title, value: row.value },
  });
  return row;
}

/** Tahap won/lost dikenali dari nama stage Close Won / Close Lost. */
/** Samakan nama stage sebelum dibanding: spasi tepi + kapitalisasi diabaikan. */
export function normalizeStageName(name: string): string {
  return name.trim().toLowerCase();
}

function stageOutcome(stageName: string): "open" | "won" | "lost" {
  const norm = normalizeStageName(stageName);
  if (norm === "close won") return "won";
  if (norm === "close lost") return "lost";
  return "open";
}

/** Pindah deal ke stage lain; status open/won/lost mengikuti stage tujuan. */
export async function moveDeal(
  userId: string,
  orgId: string,
  dealId: string,
  stageId: string,
): Promise<CrmDeal> {
  await requireOrgRole(userId, orgId, "member");
  const deal = await requireDeal(orgId, dealId);
  // Guard optimis: deal closed adalah terminal (closeDeal tidak bisa
  // dibatalkan) — move tidak boleh membuka ulang / retarget deal closed
  // (cubic P1 deals/service:90, race moveDeal vs closeDeal).
  if (deal.status !== "open") {
    throw new Error(
      `Deal sudah ${deal.status}; tidak bisa dipindah atau dibuka ulang.`,
    );
  }
  const [stage] = await db
    .select()
    .from(crmStages)
    .where(and(eq(crmStages.id, stageId), eq(crmStages.orgId, orgId)))
    .limit(1);
  if (!stage || stage.pipelineId !== deal.pipelineId) {
    throw new NotFoundError("Stage tidak ditemukan.");
  }
  // Satu jalur close: pindah (drag) ke Close Won/Lost ditolak — penutupan
  // wajib lewat closeDeal agar semantik outcome, kopling quotation, dan
  // idempotensinya berlaku. Lompat antar tahap open tetap bebas (gerak
  // sales wajar, mis. inbound yang langsung minta quotation).
  const status = stageOutcome(stage.name);
  if (status !== "open") {
    throw new Error(
      `Tidak bisa pindah ke ${stage.name}: tutup deal lewat tombol Close Won/Lost.`,
    );
  }
  const [row] = await db
    .update(crmDeals)
    .set({
      stageId,
      status,
      closedAt: status === "open" ? null : new Date(),
    })
    // Predikat expected-state: closeDeal konkuren yang menulis duluan membuat
    // update ini match 0 baris — move antrean tidak menimpa deal yang sudah
    // closed (cubic P1 deals/service:90).
    .where(
      and(
        eq(crmDeals.id, dealId),
        eq(crmDeals.orgId, orgId),
        eq(crmDeals.status, deal.status),
      ),
    )
    .returning();
  if (!row) {
    // Kalah race terhadap close: re-read lalu lempar error basi (Indonesia),
    // deal tetap closed (cubic P1 deals/service:90).
    const [current] = await db
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.orgId, orgId)))
      .limit(1);
    if (!current) throw new NotFoundError("Deal tidak ditemukan.");
    throw new Error(
      `Permintaan pindah basi: deal sudah ${current.status}; muat ulang papan.`,
    );
  }
  await recordAudit({
    orgId,
    userId,
    action: "crm.deal.move",
    entity: "crm_deal",
    entityId: dealId,
    // Audit pakai status pasca-guard (row), bukan status hasil hitung
    // pra-tulis (cubic P1 deals/service:90).
    metadata: {
      fromStageId: deal.stageId,
      toStageId: row.stageId,
      status: row.status,
    },
  });
  return row;
}

/**
 * Ubah judul/nilai/kontak deal open. Deal closed terminal (judul/nilai
 * histori tak bisa ditulis ulang); stage/status hanya lewat move/close.
 */
export async function updateDeal(
  userId: string,
  orgId: string,
  id: string,
  input: Partial<{
    title: string;
    value: number;
    contactId: string | null;
  }>,
): Promise<CrmDeal> {
  await requireOrgRole(userId, orgId, "member");
  const deal = await requireDeal(orgId, id);
  if (deal.status !== "open") {
    throw new Error(
      `Deal sudah ${deal.status}; tidak bisa diubah.`,
    );
  }
  if (input.value !== undefined) assertSafeAmount(input.value, "Nilai deal");
  if (input.contactId) {
    const [contact] = await db
      .select({ id: crmContacts.id })
      .from(crmContacts)
      .where(
        and(
          eq(crmContacts.id, input.contactId),
          eq(crmContacts.orgId, orgId),
          eq(crmContacts.companyId, deal.companyId),
        ),
      )
      .limit(1);
    if (!contact) throw new NotFoundError("Kontak tidak ditemukan.");
  }
  const [row] = await db
    .update(crmDeals)
    .set(input)
    .where(and(eq(crmDeals.id, id), eq(crmDeals.orgId, orgId)))
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "crm.deal.update",
    entity: "crm_deal",
    entityId: id,
    metadata: input as Record<string, unknown>,
  });
  return row;
}

/**
 * Hapus deal OPEN beserta aktivitasnya (cascade FK). Deal won/lost adalah
 * histori penjualan — tidak bisa dihapus.
 */
export async function deleteDeal(
  userId: string,
  orgId: string,
  id: string,
): Promise<void> {
  await requireOrgRole(userId, orgId, "member");
  const deal = await requireDeal(orgId, id);
  if (deal.status !== "open") {
    throw new Error(
      `Deal sudah ${deal.status}; histori closed tidak bisa dihapus.`,
    );
  }
  await db
    .delete(crmDeals)
    .where(and(eq(crmDeals.id, id), eq(crmDeals.orgId, orgId)));
  await recordAudit({
    orgId,
    userId,
    action: "crm.deal.delete",
    entity: "crm_deal",
    entityId: id,
    metadata: { title: deal.title },
  });
}

// ---------------- Activities ----------------

export async function listActivities(
  orgId: string,
  dealId: string,
): Promise<CrmActivity[]> {
  await requireDeal(orgId, dealId);
  return db
    .select()
    .from(crmActivities)
    .where(
      and(eq(crmActivities.orgId, orgId), eq(crmActivities.dealId, dealId)),
    )
    .orderBy(desc(crmActivities.createdAt));
}

export async function createActivity(
  userId: string,
  orgId: string,
  input: {
    dealId: string;
    type: "call" | "task" | "meeting" | "note";
    content: string;
  },
): Promise<CrmActivity> {
  await requireOrgRole(userId, orgId, "member");
  await requireDeal(orgId, input.dealId);
  if (!["call", "task", "meeting", "note"].includes(input.type)) {
    throw new Error("Jenis aktivitas tidak valid.");
  }
  const [row] = await db
    .insert(crmActivities)
    .values({
      orgId,
      dealId: input.dealId,
      userId,
      type: input.type,
      content: input.content,
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "crm.activity.create",
    entity: "crm_activity",
    entityId: row.id,
    metadata: { type: input.type, dealId: input.dealId },
  });
  return row;
}
