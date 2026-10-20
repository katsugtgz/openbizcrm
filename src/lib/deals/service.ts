import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { crmDeals, crmStages } from "@/db/schema";
import { NotFoundError, requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";
import { normalizeStageName, type CrmDeal } from "@/lib/repos/crm-repo";

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
 *
 * Kopling deal-quotation: won mensyaratkan quotation accepted (deal tidak
 * bisa dimenangkan dengan quote draft-tak-terkirim / rejected); lost bebas
 * dari status quotation mana pun (deal bisa gugur di tahap awal).
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
  return db.transaction(async (tx) => {
    const [deal] = await tx
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.orgId, orgId)))
      .limit(1);
    if (!deal) throw new NotFoundError("Deal tidak ditemukan.");
    // Sudah closed: outcome sama = idempoten; outcome lain = konflik, lempar
    // (UI tidak boleh melaporkan outcome yang tidak pernah diterapkan).
    if (deal.status !== "open") {
      // Pre-read bisa basi saat moveDeal konkuren mengubah deal closed —
      // revalidasi kondisional dengan WHERE status='outcome' sebelum
      // dilaporkan sudah diterapkan (cubic P2 service:41).
      if (deal.status === outcome) {
        const [fresh] = await tx
          .select()
          .from(crmDeals)
          .where(
            and(
              eq(crmDeals.id, dealId),
              eq(crmDeals.orgId, orgId),
              eq(crmDeals.status, outcome),
            ),
          )
          .limit(1);
        if (fresh) return fresh;
        // Basinya: deal berpindah sejak pre-read — lanjut ke close berikutnya.
      } else {
        throw new Error(
          `Deal sudah ${deal.status}; tidak bisa ditutup sebagai ${outcome}.`,
        );
      }
    }
    // Won tanpa quotation accepted = histori fiktif (deal menang tanpa
    // penawaran yang disetujui). Cek di pre-read: accepted terminal sehingga
    // tidak bisa mundur di bawah kaki kita; sent yang ter-accept konkuren
    // tinggal retry.
    if (outcome === "won" && deal.quotationStatus !== "accepted") {
      throw new Error(
        "Deal hanya bisa dimenangkan setelah quotation diterima (accepted).",
      );
    }
    // Resolusi stage target ternormalisasi + anti-ambiguitas: nama stage
    // tidak unik per pipeline (unique hanya (pipeline, position)), jadi
    // LIMIT 1 atas "Close Won" bisa salah pilih saat duplikat. Bandingkan
    // ternormalisasi (spasi tepi + kapitalisasi diabaikan) dan tolak tegas
    // saat nol/ganda, bukan misroute diam-diam.
    const targetName = outcome === "won" ? "close won" : "close lost";
    const stages = await tx
      .select({ id: crmStages.id, name: crmStages.name })
      .from(crmStages)
      .where(eq(crmStages.pipelineId, deal.pipelineId));
    const matches = stages.filter(
      (s) => normalizeStageName(s.name) === targetName,
    );
    if (matches.length === 0) {
      throw new NotFoundError(
        `Stage Close ${outcome === "won" ? "Won" : "Lost"} tidak ada di pipeline.`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Ambigu: ${matches.length} stage bernama Close ${outcome === "won" ? "Won" : "Lost"} di pipeline; rapikan nama stage dahulu.`,
      );
    }
    const stage = matches[0];
    const now = new Date();
    const [row] = await tx
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
      // idempoten (re-read kondisional, deal bisa terhapus sejak pre-read);
      // outcome lain = konflik; deal hilang = NotFoundError type service
      // terjaga (cubic P2 service:88).
      const [current] = await tx
        .select()
        .from(crmDeals)
        .where(
          and(
            eq(crmDeals.id, dealId),
            eq(crmDeals.orgId, orgId),
            eq(crmDeals.status, outcome),
          ),
        )
        .limit(1);
      if (current) return current;
      const [any] = await tx
        .select({ status: crmDeals.status })
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.orgId, orgId)))
        .limit(1);
      if (!any) throw new NotFoundError("Deal tidak ditemukan.");
      throw new Error(
        `Deal sudah ${any.status}; tidak bisa ditutup sebagai ${outcome}.`,
      );
    }
    // Audit ikut tx yang sama: tulis close tanpa jejak audit tidak bisa
    // commit separuh (recordAudit gagal => seluruh close rollback).
    await recordAudit(
      {
        orgId,
        userId,
        action: `crm.deal.${outcome}`,
        entity: "crm_deal",
        entityId: dealId,
        metadata: { stageId: stage.id },
      },
      tx,
    );
    return row;
  });
}

/**
 * Ubah status quotation deal (draft/sent/accepted/rejected) mengikuti
 * transisi valid. Lempar Error untuk transisi ilegal.
 *
 * Deal closed adalah terminal: quotation-nya beku (mengubah quote deal
 * won/lost menulis ulang histori). Audit transisi memotret nilai deal saat
 * itu — satu-satunya nominal quotation yang dilacak sistem (persistensi
 * total per baris butuh kolom schema baru).
 */
export async function setQuotationStatus(
  userId: string,
  orgId: string,
  dealId: string,
  next: QuotationStatus,
): Promise<CrmDeal> {
  await requireOrgRole(userId, orgId, "member");
  return db.transaction(async (tx) => {
    const [deal] = await tx
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.orgId, orgId)))
      .limit(1);
    if (!deal) throw new NotFoundError("Deal tidak ditemukan.");
    if (deal.status !== "open") {
      throw new Error(
        `Quotation deal yang sudah ${deal.status} tidak bisa diubah.`,
      );
    }
    const allowed = QUOTATION_TRANSITIONS[deal.quotationStatus] ?? [];
    if (!allowed.includes(next)) {
      throw new Error(
        `Transisi quotation tidak valid: ${deal.quotationStatus} -> ${next}.`,
      );
    }
    const [row] = await tx
      .update(crmDeals)
      .set({ quotationStatus: next })
      // WHERE mengunci status tervalidasi: dua transisi konkuren dari status
      // sama tak bisa duanya berhasil (cubic P2 service:92). Predikat
      // status='open' menutup race lawan closeDeal konkuren: close yang
      // menang membuat update ini match 0 baris.
      .where(
        and(
          eq(crmDeals.id, dealId),
          eq(crmDeals.orgId, orgId),
          eq(crmDeals.quotationStatus, deal.quotationStatus),
          eq(crmDeals.status, "open"),
        ),
      )
      .returning();
    if (!row) {
      const [current] = await tx
        .select({ status: crmDeals.status })
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.orgId, orgId)))
        .limit(1);
      if (current && current.status !== "open") {
        throw new Error(
          `Quotation deal yang sudah ${current.status} tidak bisa diubah.`,
        );
      }
      throw new Error(
        `Transisi quotation tidak valid: ${deal.quotationStatus} -> ${next}.`,
      );
    }
    await recordAudit(
      {
        orgId,
        userId,
        action: "crm.deal.quotation_status",
        entity: "crm_deal",
        entityId: dealId,
        metadata: { from: deal.quotationStatus, to: next, value: deal.value },
      },
      tx,
    );
    return row;
  });
}
