/**
 * Team chat service: percakapan (group/direct) + pesan.
 *
 * Kontrak hardening: repos orgId-first, requireOrgRole di setiap mutasi,
 * audit via recordAudit (tx-aware), sesi WorkOS diselesaikan di actions.
 * Akses percakapan = keanggotaan chatConversationMembers (bukan sekadar
 * keanggotaan org). Percakapan direct: pasangan anggota dedupe — percakapan
 * 1:1 yang sama tidak dibuat dua kali.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  chatConversationMembers,
  chatConversations,
  chatMessages,
  type ChatConversation,
  type ChatMessage,
} from "@/db/schema";
import { NotFoundError, requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";
import { publishChatMessage } from "./realtime";

export class ChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatError";
  }
}

/** Anggota wajib ada; org guard tetap requireOrgRole di luar ini. */
async function requireConversation(
  orgId: string,
  conversationId: string,
): Promise<ChatConversation> {
  const [conv] = await db
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.id, conversationId),
        eq(chatConversations.orgId, orgId),
      ),
    )
    .limit(1);
  if (!conv) throw new NotFoundError("Percakapan tidak ditemukan.");
  return conv;
}

/** Non-member ditolak eksplisit (bukan NotFound — caller sudah lolos org guard). */
export async function requireMember(
  conversationId: string,
  userId: string,
): Promise<void> {
  const [m] = await db
    .select({ id: chatConversationMembers.id })
    .from(chatConversationMembers)
    .where(
      and(
        eq(chatConversationMembers.conversationId, conversationId),
        eq(chatConversationMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!m) throw new ChatError("Anda bukan anggota percakapan ini.");
}

export interface DirectPair {
  conversationId: string;
  created: boolean;
}

/**
 * Percakapan direct 1:1: idempoten per pasangan user. Cari percakapan
 * direct yang berisi TEPAT kedua user; buat baru hanya jika belum ada.
 */
export async function openDirect(
  userId: string,
  orgId: string,
  otherUserId: string,
): Promise<DirectPair> {
  if (userId === otherUserId) {
    throw new ChatError(
      "Percakapan direct dengan diri sendiri tidak didukung.",
    );
  }
  await requireOrgRole(userId, orgId, "member");
  await requireOrgRole(otherUserId, orgId, "member");

  // Serialize + recheck di dalam satu tx (P2 cubic pr9 :115): dua openDirect
  // konkuren untuk pasangan sama tidak bisa buat duplikat — lookup kedua
  // dilakukan setelah advisory lock per-org.
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`chat:${orgId}`}))`,
    );
    // Percakapan direct org ini yang memuat kedua user sebagai anggota,
    // dan total anggotanya tepat 2.
    const [existing] = await tx
      .select({ c: chatConversations })
      .from(chatConversations)
      .innerJoin(
        chatConversationMembers,
        eq(chatConversationMembers.conversationId, chatConversations.id),
      )
      .where(
        and(
          eq(chatConversations.orgId, orgId),
          eq(chatConversations.kind, "direct"),
          inArray(chatConversationMembers.userId, [userId, otherUserId]),
        ),
      )
      .groupBy(chatConversations.id)
      .having(
        sql`count(distinct ${chatConversationMembers.userId}) = 2
            and count(*) = 2`,
      )
      .limit(1);
    if (existing) {
      return { conversationId: existing.c.id, created: false };
    }

    const [conv] = await tx
      .insert(chatConversations)
      .values({ orgId, kind: "direct", createdBy: userId })
      .returning();
    await tx.insert(chatConversationMembers).values([
      { conversationId: conv.id, userId },
      { conversationId: conv.id, userId: otherUserId },
    ]);
    await recordAudit(
      {
        orgId,
        userId,
        action: "chat.direct.open",
        entity: "chat_conversation",
        entityId: conv.id,
        metadata: { otherUserId },
      },
      tx,
    );
    return { conversationId: conv.id, created: true };
  });
}

export interface CreateGroupInput {
  name: string;
  memberUserIds: string[];
}

export async function createGroup(
  userId: string,
  orgId: string,
  input: CreateGroupInput,
): Promise<ChatConversation> {
  if (!input.name.trim()) throw new ChatError("Nama percakapan wajib diisi.");
  const memberIds = [...new Set(input.memberUserIds)].filter(
    (id) => id !== userId,
  );
  await requireOrgRole(userId, orgId, "member");
  // Semua anggota wajib member org ini (isi anggota tidak boleh lintas org).
  for (const id of memberIds) {
    await requireOrgRole(id, orgId, "member");
  }
  const conv = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(chatConversations)
      .values({
        orgId,
        kind: "group",
        name: input.name.trim(),
        createdBy: userId,
      })
      .returning();
    await tx
      .insert(chatConversationMembers)
      .values([
        { conversationId: row.id, userId },
        ...memberIds.map((uid) => ({ conversationId: row.id, userId: uid })),
      ]);
    await recordAudit(
      {
        orgId,
        userId,
        action: "chat.group.create",
        entity: "chat_conversation",
        entityId: row.id,
        metadata: { name: input.name, members: [userId, ...memberIds].length },
      },
      tx,
    );
    return row;
  });
  return conv;
}

export async function listConversations(
  userId: string,
  orgId: string,
): Promise<(ChatConversation & { memberCount: number })[]> {
  const rows = await db
    .select({
      c: chatConversations,
      memberCount: sql<number>`count(${chatConversationMembers.id})::int`,
    })
    .from(chatConversations)
    .innerJoin(
      chatConversationMembers,
      eq(chatConversationMembers.conversationId, chatConversations.id),
    )
    .where(
      and(
        eq(chatConversations.orgId, orgId),
        sql`exists (select 1 from ${chatConversationMembers} m2
            where m2.conversation_id = ${chatConversations.id}
            and m2.user_id = ${userId})`,
      ),
    )
    .groupBy(chatConversations.id)
    .orderBy(desc(chatConversations.createdAt));
  return rows.map((r) => ({ ...r.c, memberCount: r.memberCount }));
}

export async function sendMessage(
  userId: string,
  orgId: string,
  conversationId: string,
  body: string,
): Promise<ChatMessage> {
  await requireOrgRole(userId, orgId, "member");
  await requireConversation(orgId, conversationId);
  await requireMember(conversationId, userId);
  if (!body.trim()) throw new ChatError("Pesan tidak boleh kosong.");

  const [msg] = await db
    .insert(chatMessages)
    .values({
      conversationId,
      orgId,
      userId,
      body: body.trim(),
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "chat.message.send",
    entity: "chat_message",
    entityId: msg.id,
    metadata: { conversationId },
  });
  // Fire-and-forget: realtime gagal tidak boleh gagalkan pesan.
  void publishChatMessage({
    conversationId,
    orgId,
    messageId: msg.id,
    userId,
    body: msg.body,
    createdAt: msg.createdAt.toISOString(),
  });
  return msg;
}

export async function listMessages(
  userId: string,
  orgId: string,
  conversationId: string,
  limit = 50,
): Promise<ChatMessage[]> {
  await requireOrgRole(userId, orgId, "member");
  await requireConversation(orgId, conversationId);
  await requireMember(conversationId, userId);
  // Window TERBARU (P2 cubic pr9 :270): ambil pesan terbaru dulu (desc),
  // lalu dibalik jadi urutan kronologis. Tanpa ini percakapan >50 pesan
  // selalu menampilkan 50 pesan tertua dan pesan baru tak terlihat.
  const capped = Math.min(Math.max(limit, 1), 200);
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(capped);
  return rows.reverse();
}

/** Anggota percakapan (untuk UI daftar peserta). */
export async function listMembers(
  userId: string,
  orgId: string,
  conversationId: string,
): Promise<{ userId: string }[]> {
  await requireOrgRole(userId, orgId, "member");
  await requireConversation(orgId, conversationId);
  await requireMember(conversationId, userId);
  return db
    .select({ userId: chatConversationMembers.userId })
    .from(chatConversationMembers)
    .where(eq(chatConversationMembers.conversationId, conversationId))
    .orderBy(asc(chatConversationMembers.joinedAt));
}
