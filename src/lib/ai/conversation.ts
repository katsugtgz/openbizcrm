/**
 * Persistensi percakapan AI org-scoped. Route: resolve sesi -> buat
 * conversation -> simpan pesan user -> provider complete -> simpan balasan
 * assistant. Semua tulisan dalam satu tx per langkah, audit per conversation.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  aiConversations,
  aiMessages,
  type AiConversation,
  type AiMessage,
} from "@/db/schema";
import { NotFoundError } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";

/** Buat conversation baru org-scoped + audit. */
export async function createConversation(
  userId: string,
  orgId: string,
): Promise<AiConversation> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(aiConversations)
      .values({ orgId, userId })
      .returning();
    await recordAudit(
      {
        orgId,
        userId,
        action: "ai.conversation.create",
        entity: "ai_conversation",
        entityId: row.id,
      },
      tx,
    );
    return row;
  });
}

export async function appendMessage(
  orgId: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  exec: Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db = db,
): Promise<AiMessage> {
  // Guard org dulu (P1 cubic pr9): conversation milik org lain tidak boleh
  // disuntik pesan — sama seperti listMessages di bawah.
  const [conv] = await exec
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.orgId, orgId),
      ),
    )
    .limit(1);
  if (!conv) throw new NotFoundError("Percakapan tidak ditemukan.");
  const [row] = await exec
    .insert(aiMessages)
    .values({ conversationId, role, content })
    .returning();
  return row;
}

/** Jendela riwayat default untuk prompt: riwayat penuh bikin tiap POST makin lambat + mahal. */
export const AI_HISTORY_DEFAULT_LIMIT = 100;
export const AI_HISTORY_MAX_LIMIT = 500;

/**
 * Pesan conversation urut waktu — hanya milik org terkait (guard org).
 * Jendela TERBARU (bukan tertua): N terakhir urut kronologis — pola sama
 * seperti listMessages chat (desc + limit, lalu reverse).
 */
export async function listMessages(
  orgId: string,
  conversationId: string,
  limit = AI_HISTORY_DEFAULT_LIMIT,
): Promise<AiMessage[]> {
  const [conv] = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.orgId, orgId),
      ),
    )
    .limit(1);
  if (!conv) return [];
  const capped = Math.min(Math.max(limit, 1), AI_HISTORY_MAX_LIMIT);
  const rows = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(desc(aiMessages.createdAt))
    .limit(capped);
  return rows.reverse();
}
