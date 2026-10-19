import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { crmDeals, crmStages } from "@/db/schema";
import { NotFoundError, requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";
import type { CrmDeal } from "@/lib/repos/crm-repo";

export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected";

/** Transisi quotation valid: draft -> sent -> (accepted | rejected). */
const QUOTATION_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  draft: ["sent"],
  sent: ["accepted", "rejected"],
  accepted: [],
  rejected: [],
};

/**
 * Tandai deal won/lost via stage Close Won / Close Lost pipeline-nya.
 * Idempotent untuk deal yang sudah closed.
 */
export async function closeDeal(
  userId: string,
  orgId: string,
  dealId: string,
  outcome: "won" | "lost",
): Promise<CrmDeal> {
  await requireOrgRole(userId, orgId, "member");
  if (outcome !== "won" && outcome !== "lost") {
    throw new Error("Outcome harus 'won' atau 'lost'.");
  }
  const [deal] = await db
    .select()
    .from(crmDeals)
    .where(and(eq(crmDeals.id, dealId), eq(crmDeals.orgId, orgId)))
    .limit(1);
  if (!deal) throw new NotFoundError("Deal tidak ditemukan.");
  // Sudah closed: outcome sama = idempoten; outcome lain = konflik, lempar
  // (UI tidak boleh melaporkan outcome yang tidak pernah diterapkan).
  if (deal.status !== "open") {
    if (deal.status === outcome) return deal;
    throw new Error(
      `Deal sudah ${deal.status}; tidak bisa ditutup sebagai ${outcome}.`,
    );
  }
  const [stage] = await db
    .select()
    .from(crmStages)
    .where(
      and(
        eq(crmStages.pipelineId, deal.pipelineId),
        eq(crmStages.name, outcome === "won" ? "Close Won" : "Close Lost"),
      ),
    )
    .limit(1);
  if (!stage) {
    throw new NotFoundError(
      `Stage Close ${outcome === "won" ? "Won" : "Lost"} tidak ada di pipeline.`,
    );
  }
  const now = new Date();
  const [row] = await db
    .update(crmDeals)
    .set({ stageId: stage.id, status: outcome, closedAt: now })
    // WHERE status='open': dua close konkuren — hanya satu menulis; yang
    // kalah lihat returning kosong dan ulang read untuk keputusan idempoten/
    // konflik (cubic P2 service:39, race-safe).
    .where(
      and(
        eq(crmDeals.id, dealId),
        eq(crmDeals.orgId, orgId),
        eq(crmDeals.status, "open"),
      ),
    )
    .returning();
  if (!row) {
    // Kalah race: deal sudah closed oleh request lain. Outcome sama =
    // idempoten; outcome lain = konflik.
    const [current] = await db
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.orgId, orgId)))
      .limit(1);
    if (current && current.status === outcome) return current;
    throw new Error(
      current
        ? `Deal sudah ${current.status}; tidak bisa ditutup sebagai ${outcome}.`
        : "Deal tidak ditemukan.",
    );
  }
  await recordAudit({
    orgId,
    userId,
    action: `crm.deal.${outcome}`,
    entity: "crm_deal",
    entityId: dealId,
    metadata: { stageId: stage.id },
  });
  return row;
}

/**
 * Ubah status quotation deal (draft/sent/accepted/rejected) mengikuti
 * transisi valid. Lempar Error untuk transisi ilegal.
 */
export async function setQuotationStatus(
  userId: string,
  orgId: string,
  dealId: string,
  next: QuotationStatus,
): Promise<CrmDeal> {
  await requireOrgRole(userId, orgId, "member");
  const [deal] = await db
    .select()
    .from(crmDeals)
    .where(and(eq(crmDeals.id, dealId), eq(crmDeals.orgId, orgId)))
    .limit(1);
  if (!deal) throw new NotFoundError("Deal tidak ditemukan.");
  const allowed = QUOTATION_TRANSITIONS[deal.quotationStatus];
  if (!allowed.includes(next)) {
    throw new Error(
      `Transisi quotation tidak valid: ${deal.quotationStatus} -> ${next}.`,
    );
  }
  const [row] = await db
    .update(crmDeals)
    .set({ quotationStatus: next })
    // WHERE mengunci status tervalidasi: dua transisi konkuren dari status
    // sama tak bisa duanya berhasil (cubic P2 service:92).
    .where(
      and(
        eq(crmDeals.id, dealId),
        eq(crmDeals.orgId, orgId),
        eq(crmDeals.quotationStatus, deal.quotationStatus),
      ),
    )
    .returning();
  if (!row) {
    throw new Error(
      `Transisi quotation tidak valid: ${deal.quotationStatus} -> ${next}.`,
    );
  }
  await recordAudit({
    orgId,
    userId,
    action: "crm.deal.quotation_status",
    entity: "crm_deal",
    entityId: dealId,
    metadata: { from: deal.quotationStatus, to: next },
  });
  return row;
}
