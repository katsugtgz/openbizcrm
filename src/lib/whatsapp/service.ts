/**
 * Service WhatsApp org-scoped: sesi status (machine state murni dipakai di
 * sini) + antrean outbox. Socket Baileys asli berjalan proses terpisah
 * (out of scope) — proses itu nanti membaca/menulis baris ini. Semua mutasi
 * org-guarded, transaction + advisory lock, audit.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  whatsappOutbox,
  whatsappSessions,
  type WhatsappOutboxRow,
  type WhatsappSession,
} from "@/db/schema";
import { NotFoundError, requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";
import {
  InvalidWhatsappTransitionError,
  nextWhatsappStatus,
  type WhatsappStatus,
} from "./session-state";

export { InvalidWhatsappTransitionError };

/** Sesi org, dibuat lazy (default disconnected). */
async function requireSession(orgId: string): Promise<WhatsappSession> {
  const [existing] = await db
    .select()
    .from(whatsappSessions)
    .where(eq(whatsappSessions.orgId, orgId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(whatsappSessions)
    .values({ orgId })
    .onConflictDoNothing({ target: whatsappSessions.orgId })
    .returning();
  if (created) return created;
  const [raced] = await db
    .select()
    .from(whatsappSessions)
    .where(eq(whatsappSessions.orgId, orgId))
    .limit(1);
  if (!raced) throw new NotFoundError("Sesi WhatsApp tidak ditemukan.");
  return raced;
}

/**
 * Transisi status sesi org. Read-modify-write dalam satu tx dengan advisory
 * lock per org (family lock sama dengan accounting: menulis ke table yang
 * sama per-org, konsistensi cukup di level org). Optimistic: status dibaca
 * ulang DALAM tx, bukan dari luar — state machine murni menolak lompatan.
 */
export async function transitionWhatsappSession(
  userId: string,
  orgId: string,
  to: WhatsappStatus,
  extra?: { qrCode?: string | null; phone?: string | null },
): Promise<WhatsappSession> {
  await requireOrgRole(userId, orgId, "member");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`wa:${orgId}`}))`,
    );
    let [current] = await tx
      .select()
      .from(whatsappSessions)
      .where(eq(whatsappSessions.orgId, orgId))
      .limit(1)
      .for("update");
    if (!current) {
      // Buat dalam tx yang sama bila belum ada (idempoten, lock dipakai).
      const [created] = await tx
        .insert(whatsappSessions)
        .values({ orgId })
        .onConflictDoNothing({ target: whatsappSessions.orgId })
        .returning();
      if (!created) throw new NotFoundError("Sesi WhatsApp tidak ditemukan.");
      current = created;
    }
    const next = nextWhatsappStatus(current.status, to);
    const [updated] = await tx
      .update(whatsappSessions)
      .set({
        status: next,
        qrCode: next === "qr" ? (extra?.qrCode ?? current.qrCode) : null,
        phone:
          next === "connected"
            ? (extra?.phone ?? current.phone)
            : current.phone,
        updatedAt: new Date(),
      })
      .where(eq(whatsappSessions.id, current.id))
      .returning();
    await recordAudit(
      {
        orgId,
        userId,
        action: "whatsapp.session.transition",
        entity: "whatsapp_session",
        entityId: updated.id,
        metadata: { from: current.status, to: next },
      },
      tx,
    );
    return updated;
  });
}

export interface EnqueueOutboxInput {
  phone: string;
  message: string;
}

/** Antrekan kiriman WA; hanya saat sesi connected. */
export async function enqueueWhatsappMessage(
  userId: string,
  orgId: string,
  input: EnqueueOutboxInput,
): Promise<WhatsappOutboxRow> {
  await requireOrgRole(userId, orgId, "member");
  const session = await requireSession(orgId);
  if (session.status !== "connected") {
    throw new Error(
      "Sesi WhatsApp belum tersambung — hubungkan dulu sebelum mengirim.",
    );
  }
  if (!input.phone.trim() || !input.message.trim()) {
    throw new Error("Nomor dan isi pesan wajib diisi.");
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`wa:${orgId}`}))`,
    );
    const [row] = await tx
      .insert(whatsappOutbox)
      .values({
        orgId,
        phone: input.phone.trim(),
        message: input.message,
        status: "queued",
      })
      .returning();
    await recordAudit(
      {
        orgId,
        userId,
        action: "whatsapp.outbox.enqueue",
        entity: "whatsapp_outbox",
        entityId: row.id,
        metadata: { phone: input.phone.trim() },
      },
      tx,
    );
    return row;
  });
}

/** Baris queued milik org, urut dibuat (FIFO) — dibaca worker. */
export async function listQueuedOutbox(
  orgId: string,
  limit = 50,
): Promise<WhatsappOutboxRow[]> {
  return db
    .select()
    .from(whatsappOutbox)
    .where(
      and(eq(whatsappOutbox.orgId, orgId), eq(whatsappOutbox.status, "queued")),
    )
    .orderBy(asc(whatsappOutbox.createdAt))
    .limit(limit);
}

export interface OutboxResult {
  id: string;
  ok: boolean;
  error?: string;
}

/**
 * Tandai hasil kirim worker (sent / failed + pesan error). Idempoten per
 * baris: sudah sent/failed => tanpa perubahan (transisi terminal).
 */
export async function resolveOutbox(
  userId: string,
  orgId: string,
  result: OutboxResult,
): Promise<WhatsappOutboxRow | null> {
  await requireOrgRole(userId, orgId, "member");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`wa:${orgId}`}))`,
    );
    const [row] = await tx
      .select()
      .from(whatsappOutbox)
      .where(
        and(eq(whatsappOutbox.id, result.id), eq(whatsappOutbox.orgId, orgId)),
      )
      .limit(1)
      .for("update");
    if (!row) return null;
    if (row.status !== "queued") return row; // terminal: idempoten
    const [updated] = await tx
      .update(whatsappOutbox)
      .set({
        status: result.ok ? "sent" : "failed",
        attempts: row.attempts + 1,
        lastError: result.ok ? null : (result.error ?? "Gagal mengirim."),
        sentAt: result.ok ? new Date() : null,
      })
      .where(eq(whatsappOutbox.id, row.id))
      .returning();
    await recordAudit(
      {
        orgId,
        userId,
        action: "whatsapp.outbox.resolve",
        entity: "whatsapp_outbox",
        entityId: row.id,
        metadata: { ok: result.ok, error: result.error ?? null },
      },
      tx,
    );
    return updated;
  });
}
