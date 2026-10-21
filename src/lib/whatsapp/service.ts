/**
 * Service WhatsApp org-scoped: sesi status (machine state murni dipakai di
 * sini) + antrean outbox. Socket Baileys asli berjalan proses terpisah
 * (out of scope) — proses itu nanti membaca/menulis baris ini. Semua mutasi
 * org-guarded, transaction + advisory lock, audit.
 */
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
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

/** Upaya kirim maksimum per baris outbox sebelum terminal `failed`. */
export const MAX_OUTBOX_ATTEMPTS = 5;

/**
 * Umur lease klaim sebelum baris `sending` boleh direclaim worker lain
 * (cubic pr10 wa-service:340). 2x timeout sender: klaim sehat selalu
 * resolve jauh sebelum lease kedaluwarsa.
 */
export const CLAIM_LEASE_MS = 60_000;

/** Samarkan nomor untuk audit member-readable: +628******1234. */
export function maskPhone(phone: string): string {
  const p = phone.trim();
  if (p.length <= 4) return "****";
  const prefix = p.startsWith("+") ? "+" : "";
  return `${prefix}${"*".repeat(Math.max(p.length - prefix.length - 4, 1))}${p.slice(-4)}`;
}

/**
 * Samarkan nomor di dalam pesan error sender sebelum masuk audit
 * member-readable (error Baileys boleh menyebut nomor tujuan, mis.
 * "gagal kirim ke 62812..."). Digit-run >= 7 disamarkan, teks alasan
 * dipertahankan; lastError operasional tidak diubah.
 */
export function redactSenderError(error: string): string {
  return error.replace(/\+?[\d][\d\s().-]{5,}[\d]/g, (m) =>
    maskPhone(m.replace(/[\s().-]/g, "")),
  );
}

/** Sesi org, dibuat lazy (default disconnected). Dipakai actions (GET). */
export async function requireSession(orgId: string): Promise<WhatsappSession> {
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
  if (!input.phone.trim() || !input.message.trim()) {
    throw new Error("Nomor dan isi pesan wajib diisi.");
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`wa:${orgId}`}))`,
    );
    // Validasi sesi DI DALAM tx ber-lock (P1): transisi disconnect konkuren
    // tidak bisa commit di antara cek dan insert.
    let [session] = await tx
      .select()
      .from(whatsappSessions)
      .where(eq(whatsappSessions.orgId, orgId))
      .limit(1)
      .for("update");
    if (!session) {
      // Lazy-create di tx yang sama; konflik konkuren -> re-read (P2).
      const [created] = await tx
        .insert(whatsappSessions)
        .values({ orgId })
        .onConflictDoNothing({ target: whatsappSessions.orgId })
        .returning();
      if (created) {
        session = created;
      } else {
        const [raced] = await tx
          .select()
          .from(whatsappSessions)
          .where(eq(whatsappSessions.orgId, orgId))
          .limit(1);
        if (!raced) throw new NotFoundError("Sesi WhatsApp tidak ditemukan.");
        session = raced;
      }
    }
    if (session.status !== "connected") {
      throw new Error(
        "Sesi WhatsApp belum tersambung — hubungkan dulu sebelum mengirim.",
      );
    }
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
        metadata: { phone: maskPhone(input.phone) },
      },
      tx,
    );
    return row;
  });
}

/**
 * Baris siap-kirim milik org, urut dibuat (FIFO) — dibaca worker. Termasuk
 * `failed` yang attempts-nya belum habis (retry otomatis tiap drain);
 * `failed` yang attempts >= MAX_OUTBOX_ATTEMPTS hanya hidup via requeue.
 */
export async function listQueuedOutbox(
  orgId: string,
  limit = 50,
): Promise<WhatsappOutboxRow[]> {
  return db
    .select()
    .from(whatsappOutbox)
    .where(
      and(
        eq(whatsappOutbox.orgId, orgId),
        or(
          eq(whatsappOutbox.status, "queued"),
          and(
            eq(whatsappOutbox.status, "failed"),
            lt(whatsappOutbox.attempts, MAX_OUTBOX_ATTEMPTS),
          ),
        ),
      ),
    )
    .orderBy(asc(whatsappOutbox.createdAt))
    .limit(limit);
}

/**
 * Klaim atomik sebelum send (hardening worker): UPDATE ... WHERE status =
 * 'queued' di dalam advisory lock per-org, jadi dua worker (atau crash
 * sebelum resolve) tidak pernah mengirim pesan yang sama dua kali. Baris
 * yang gagal diklaim (sudah diambil worker lain) dilewati. Retry: baris
 * `failed` yang attempts-nya < MAX_OUTBOX_ATTEMPTS ikut bisa diklaim.
 * attempts dihitung saat KLAIM (bukan resolve): crash sebelum resolve
 * tetap menghabiskan jatah, jadi poison guard reclaim bisa trip
 * (cubic pr10 wa-service:352). claimed_at menandai awal lease.
 */
export async function claimOutbox(
  orgId: string,
  rowId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`wa:${orgId}`}))`,
    );
    const updated = await tx
      .update(whatsappOutbox)
      .set({
        status: "sending",
        attempts: sql`${whatsappOutbox.attempts} + 1`,
        claimedAt: new Date(),
      })
      .where(
        and(
          eq(whatsappOutbox.id, rowId),
          eq(whatsappOutbox.orgId, orgId),
          or(
            eq(whatsappOutbox.status, "queued"),
            and(
              eq(whatsappOutbox.status, "failed"),
              lt(whatsappOutbox.attempts, MAX_OUTBOX_ATTEMPTS),
            ),
          ),
        ),
      )
      .returning();
    return updated.length > 0;
  });
}

export interface OutboxResult {
  id: string;
  ok: boolean;
  error?: string;
}

/**
 * Requeue manual oleh operator: `failed` -> `queued` + attempts direset.
 * Tanpa ini pesan gagal harus diketik ulang dari nol.
 */
export async function requeueOutbox(
  userId: string,
  orgId: string,
  rowId: string,
): Promise<WhatsappOutboxRow> {
  await requireOrgRole(userId, orgId, "member");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`wa:${orgId}`}))`,
    );
    const [row] = await tx
      .select()
      .from(whatsappOutbox)
      .where(and(eq(whatsappOutbox.id, rowId), eq(whatsappOutbox.orgId, orgId)))
      .limit(1)
      .for("update");
    if (!row) throw new NotFoundError("Pesan tidak ditemukan.");
    if (row.status !== "failed") {
      throw new Error("Hanya pesan gagal yang bisa diantrekan ulang.");
    }
    const [updated] = await tx
      .update(whatsappOutbox)
      .set({ status: "queued", attempts: 0, lastError: null })
      .where(eq(whatsappOutbox.id, row.id))
      .returning();
    await recordAudit(
      {
        orgId,
        userId,
        action: "whatsapp.outbox.requeue",
        entity: "whatsapp_outbox",
        entityId: row.id,
        metadata: {},
      },
      tx,
    );
    return updated;
  });
}

/**
 * Pemulihan crash: baris `sending` yang pemiliknya mati (kill -9 antara
 * claim dan resolve) tidak pernah dibaca listQueued — kembalikan ke
 * `queued` agar terkirim ulang. Baris yang attempts-nya sudah habis
 * langsung `failed` (racun tidak boleh diulang selamanya). Hanya baris
 * yang lease-nya kedaluwarsa (atau pra-lease, claimed_at NULL) yang
 * diambil — kiriman aktif worker lain tidak boleh dicuri (cubic pr10
 * wa-service:340). Dipanggil sekali saat worker start. Kembalikan jumlah
 * baris dipulihkan.
 */
export async function reclaimStuckOutbox(
  orgId: string,
  opts: { leaseMs?: number } = {},
): Promise<number> {
  const leaseMs = opts.leaseMs ?? CLAIM_LEASE_MS;
  const cutoff = new Date(Date.now() - leaseMs);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`wa:${orgId}`}))`,
    );
    const stuck = await tx
      .select()
      .from(whatsappOutbox)
      .where(
        and(
          eq(whatsappOutbox.orgId, orgId),
          eq(whatsappOutbox.status, "sending"),
          or(
            isNull(whatsappOutbox.claimedAt),
            lt(whatsappOutbox.claimedAt, cutoff),
          ),
        ),
      );
    for (const row of stuck) {
      await tx
        .update(whatsappOutbox)
        .set(
          row.attempts >= MAX_OUTBOX_ATTEMPTS
            ? {
                status: "failed",
                lastError: "Worker mati saat mengirim; batas percobaan habis.",
              }
            : { status: "queued" },
        )
        .where(eq(whatsappOutbox.id, row.id));
    }
    return stuck.length;
  });
}

/**
 * Lepaskan klaim yang resolve-nya gagal (DB blip setelah send): baris
 * `sending` kembali `queued` + attempts dihitung, jadi drain berikut
 * mencoba lagi alih-alih baris yatim selamanya (cubic pr10 worker:90).
 * At-least-once: bila send aslinya sukses, retry bisa duplikat — kalah
 * penting dibanding pesan hilang diam-diam. Hanya melepas status
 * `sending` (resolve konkuren yang menang tidak diobrak).
 */
export async function releaseClaimedOutbox(
  orgId: string,
  rowId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`wa:${orgId}`}))`,
    );
    const updated = await tx
      .update(whatsappOutbox)
      .set({
        status: "queued",
        attempts: sql`${whatsappOutbox.attempts} + 1`,
        claimedAt: null,
      })
      .where(
        and(
          eq(whatsappOutbox.id, rowId),
          eq(whatsappOutbox.orgId, orgId),
          eq(whatsappOutbox.status, "sending"),
        ),
      )
      .returning();
    return updated.length > 0;
  });
}

/**
 * Tandai hasil kirim worker (sent / failed + pesan error). Idempoten per
 * baris: sudah sent/failed => tanpa perubahan (transisi terminal per
 * resolve). attempts TIDAK dihitung di sini — klaim yang menghitung
 * (cubic pr10 wa-service:352). Retry otomatis ditangani drain:
 * list/claim menyertakan `failed` yang attempts-nya tersisa, jadi
 * `failed` hanya terminal setelah MAX_OUTBOX_ATTEMPTS atau via requeue.
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
    // "sending" berarti worker pemiliknya masih memanggil sender; resolve
    // dari worker itu sendiri tetap diterima (idempoten terminal di bawah).
    if (row.status === "sent" || row.status === "failed") return row;
    const [updated] = await tx
      .update(whatsappOutbox)
      .set({
        status: result.ok ? "sent" : "failed",
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
        metadata: {
          ok: result.ok,
          error: result.error ? redactSenderError(result.error) : null,
        },
      },
      tx,
    );
    return updated;
  });
}
