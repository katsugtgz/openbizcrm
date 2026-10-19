import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  crmActivities,
  crmCompanies,
  crmContacts,
  crmDeals,
  crmPipelines,
  crmStages,
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

// ---------------- Companies ----------------

export async function listCompanies(orgId: string): Promise<CrmCompany[]> {
  return db
    .select()
    .from(crmCompanies)
    .where(eq(crmCompanies.orgId, orgId))
    .orderBy(asc(crmCompanies.name));
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
  const [row] = await db
    .insert(crmCompanies)
    .values({
      orgId,
      name: input.name,
      industry: input.industry ?? null,
      ownerUserId: input.ownerUserId ?? null,
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
  input: Partial<{ name: string; industry: string | null }>,
): Promise<CrmCompany> {
  await requireOrgRole(userId, orgId, "member");
  await requireOrgCompany(orgId, id);
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

async function requireOrgCompany(orgId: string, id: string): Promise<void> {
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
): Promise<CrmContact[]> {
  const conds = [eq(crmContacts.orgId, orgId)];
  if (companyId) conds.push(eq(crmContacts.companyId, companyId));
  return db
    .select()
    .from(crmContacts)
    .where(and(...conds))
    .orderBy(asc(crmContacts.name));
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

// ---------------- Pipeline / stages ----------------

/**
 * Pipeline + 6 tahap default per company. Idempotent: pipeline unik per
 * (org, company, name); tahap unik per (pipeline, position).
 */
export async function getOrCreateDefaultPipeline(
  orgId: string,
  companyId: string,
): Promise<{ pipeline: CrmPipeline; stages: CrmStage[] }> {
  await requireOrgCompany(orgId, companyId);
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
    }
  }
  let stages = await db
    .select()
    .from(crmStages)
    .where(eq(crmStages.pipelineId, pipeline.id))
    .orderBy(asc(crmStages.position));
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
): Promise<CrmDeal[]> {
  const conds = [eq(crmDeals.orgId, orgId)];
  if (pipelineId) conds.push(eq(crmDeals.pipelineId, pipelineId));
  return db
    .select()
    .from(crmDeals)
    .where(and(...conds))
    .orderBy(desc(crmDeals.createdAt));
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
        and(eq(crmContacts.id, input.contactId), eq(crmContacts.orgId, orgId)),
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
function stageOutcome(stageName: string): "open" | "won" | "lost" {
  if (stageName === "Close Won") return "won";
  if (stageName === "Close Lost") return "lost";
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
  const [stage] = await db
    .select()
    .from(crmStages)
    .where(and(eq(crmStages.id, stageId), eq(crmStages.orgId, orgId)))
    .limit(1);
  if (!stage || stage.pipelineId !== deal.pipelineId) {
    throw new NotFoundError("Stage tidak ditemukan.");
  }
  const status = stageOutcome(stage.name);
  const [row] = await db
    .update(crmDeals)
    .set({
      stageId,
      status,
      closedAt: status === "open" ? null : new Date(),
    })
    .where(and(eq(crmDeals.id, dealId), eq(crmDeals.orgId, orgId)))
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "crm.deal.move",
    entity: "crm_deal",
    entityId: dealId,
    metadata: { fromStageId: deal.stageId, toStageId: stageId, status },
  });
  return row;
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
