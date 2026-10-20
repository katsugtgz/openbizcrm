/**
 * POST /api/ai/chat — { message } -> resolve sesi -> conversation tersimpan
 * -> provider complete (OpenAI-compatible) -> balasan assistant tersimpan.
 * AI belum dikonfigurasi => 503 generik (tanpa detail setup).
 */
import { generateText } from "ai";
import { and, eq } from "drizzle-orm";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { ConfigError, getAiModel, resolveAiConfig } from "@/lib/ai/provider";
import {
  appendMessage,
  createConversation,
  listMessages,
} from "@/lib/ai/conversation";
import {
  computeThisMonthSummary,
  currentMonthStart,
  formatMonthSummary,
} from "@/lib/ai/tools";
import { requireOrgRole } from "@/lib/org-scope";
import { db } from "@/db";
import { aiConversations } from "@/db/schema";
import {
  checkRateLimit,
  endTurn,
  isAllowedOrigin,
  isInsecureGatewayUrl,
  isUuid,
  toDomainErrorResponse,
  tryBeginTurn,
} from "@/app/api/_lib/guards";

/** Batas panjang pesan (cubic route.ts:37). */
const MAX_MESSAGE_LENGTH = 4000;

/** Throttle endpoint AI mahal: 20 permintaan/menit per user. */
const CHAT_RATE_LIMIT = 20;
const CHAT_RATE_WINDOW_MS = 60_000;

/** Batas tunggu satu panggilan generateText — gateway macet tidak boleh menggantung worker route. */
export const AI_GENERATION_TIMEOUT_MS = 60_000;

/** Jendela dedupe double-submit: retry pesan identik dalam jendela ini tidak menduplikasi baris user. */
export const AI_RESUBMIT_DEDUPE_WINDOW_MS = 10_000;

export async function POST(request: Request) {
  // CSRF: tolak Origin/Referer lintas-asal (cookie-authed POST).
  if (!isAllowedOrigin(request)) {
    return Response.json({ error: "Akses ditolak." }, { status: 403 });
  }
  const user = await session.getSession();
  if (!user) {
    return Response.json({ error: "Belum masuk." }, { status: 401 });
  }
  const ids = await resolveSessionIds(user);
  if (!ids) {
    return Response.json({ error: "Akses ditolak." }, { status: 403 });
  }
  const { userId, orgId } = ids;
  try {
    await requireOrgRole(userId, orgId, "member");
  } catch (e) {
    const mapped = toDomainErrorResponse(e);
    if (mapped) return mapped;
    throw e;
  }

  const throttle = checkRateLimit(
    `ai-chat:${userId}`,
    CHAT_RATE_LIMIT,
    CHAT_RATE_WINDOW_MS,
  );
  if (!throttle.ok) {
    return Response.json(
      { error: "Terlalu banyak permintaan. Coba lagi." },
      {
        status: 429,
        headers: { "Retry-After": String(throttle.retryAfterSec) },
      },
    );
  }

  let message: string;
  let requestedConversationId: string | null;
  try {
    const body = (await request.json()) as {
      message?: unknown;
      conversationId?: unknown;
    };
    message = typeof body.message === "string" ? body.message.trim() : "";
    requestedConversationId =
      typeof body.conversationId === "string" && body.conversationId
        ? body.conversationId
        : null;
  } catch {
    return Response.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }
  if (!message) {
    return Response.json({ error: "Pesan wajib diisi." }, { status: 400 });
  }
  // Batas ukuran (cubic route.ts:37): DB dan biaya provider.
  if (message.length > MAX_MESSAGE_LENGTH) {
    return Response.json(
      { error: `Pesan maksimal ${MAX_MESSAGE_LENGTH} karakter.` },
      { status: 413 },
    );
  }

  // Config error diperiksa SEBELUM menulis DB — tidak ada conversation
  // yatim ketika AI belum disetup. Pesan generik: detail setup (nama env,
  // layout .env) tidak boleh bocor ke klien.
  let config;
  try {
    config = resolveAiConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error("AI chat belum dikonfigurasi:", e.message);
      return Response.json(
        { error: "Layanan AI belum dikonfigurasi." },
        { status: 503 },
      );
    }
    throw e;
  }
  // Produksi tidak boleh mengirim data org via gateway plaintext.
  if (
    process.env.NODE_ENV === "production" &&
    isInsecureGatewayUrl(config.baseURL)
  ) {
    console.error("AI gateway tidak aman (non-https) di produksi.");
    return Response.json(
      { error: "Layanan AI tidak tersedia." },
      { status: 503 },
    );
  }

  // Lanjutkan percakapan ada bila conversationId dikirim dan milik user ini
  // di org ini — tanpa cek pemilik, anggota lain bisa membajak percakapan.
  // UUID dicek dulu agar nilai liar jadi 400, bukan 500 dari PG.
  let conversationId: string;
  if (requestedConversationId) {
    if (!isUuid(requestedConversationId)) {
      return Response.json(
        { error: "Percakapan tidak valid." },
        { status: 400 },
      );
    }
    const [conv] = await db
      .select({ id: aiConversations.id, userId: aiConversations.userId })
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.id, requestedConversationId),
          eq(aiConversations.orgId, orgId),
        ),
      )
      .limit(1);
    if (!conv || conv.userId !== userId) {
      return Response.json(
        { error: "Percakapan tidak ditemukan." },
        { status: 404 },
      );
    }
    conversationId = conv.id;
  } else {
    conversationId = (await createConversation(userId, orgId)).id;
  }

  // Satu giliran per conversation: tolak turn konkuren agar pesan tidak
  // terduplikasi/terinterleave.
  if (!tryBeginTurn(conversationId)) {
    return Response.json(
      { error: "Percakapan sedang diproses. Coba lagi.", conversationId },
      { status: 409 },
    );
  }
  try {
    // Dedupe double-submit (pola chat sendMessage): bila pesan terakhir adalah
    // pesan user identik dalam jendela singkat, retry memakai baris itu —
    // tidak append duplikat (tetap generate balasan).
    const [last] = await listMessages(orgId, conversationId, 1);
    const isResubmit =
      last?.role === "user" &&
      last.content === message &&
      Date.now() - last.createdAt.getTime() < AI_RESUBMIT_DEDUPE_WINDOW_MS;
    if (!isResubmit) {
      await appendMessage(orgId, conversationId, "user", message);
    }

    const summary = formatMonthSummary(
      await computeThisMonthSummary(orgId, currentMonthStart()),
    );
    const history = await listMessages(orgId, conversationId);

    let reply: string;
    try {
      const { text } = await generateText({
        model: getAiModel(config),
        abortSignal: AbortSignal.timeout(AI_GENERATION_TIMEOUT_MS),
        system:
          "Kamu asisten bisnis OpenBizCRM. Jawab ringkas dalam bahasa Indonesia. " +
          "Gunakan data ringkasan bulan berjalan berikut bila relevan:\n" +
          summary,
        messages: history.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
      reply = text;
    } catch (e) {
      console.error("AI chat provider error:", e);
      return Response.json(
        { error: "Gagal memanggil AI. Coba lagi.", conversationId },
        { status: 502 },
      );
    }

    const assistant = await appendMessage(
      orgId,
      conversationId,
      "assistant",
      reply,
    );
    return Response.json({
      conversationId,
      reply: assistant.content,
      summary,
    });
  } catch (e) {
    const mapped = toDomainErrorResponse(e);
    if (mapped) return mapped;
    console.error("AI chat error:", e);
    return Response.json(
      { error: "Terjadi kesalahan server." },
      { status: 500 },
    );
  } finally {
    endTurn(conversationId);
  }
}
