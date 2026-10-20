/**
 * POST /api/ai/chat — { message } -> resolve sesi -> conversation tersimpan
 * -> provider complete (OpenAI-compatible) -> balasan assistant tersimpan.
 * AI belum dikonfigurasi => 503 + pesan setup (ConfigError).
 */
import { generateText } from "ai";
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

/** Batas panjang pesan (cubic route.ts:37). */
const MAX_MESSAGE_LENGTH = 4000;

export async function POST(request: Request) {
  const user = await session.getSession();
  if (!user) {
    return Response.json({ error: "Belum masuk." }, { status: 401 });
  }
  const ids = await resolveSessionIds(user);
  if (!ids) {
    return Response.json({ error: "Akses ditolak." }, { status: 403 });
  }
  const { userId, orgId } = ids;
  await requireOrgRole(userId, orgId, "member");

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
  // yatim ketika AI belum disetup.
  let config;
  try {
    config = resolveAiConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      return Response.json({ error: e.message }, { status: 503 });
    }
    throw e;
  }

  // Lanjutkan percakapan ada bila conversationId dikirim dan milik org ini
  // (cubic route.ts:57) — tanpa itu setiap POST jadi giliran satu-turn.
  let conversationId: string;
  if (requestedConversationId) {
    const existing = await listMessages(orgId, requestedConversationId);
    if (existing.length === 0) {
      return Response.json(
        { error: "Percakapan tidak ditemukan." },
        { status: 404 },
      );
    }
    conversationId = requestedConversationId;
  } else {
    conversationId = (await createConversation(userId, orgId)).id;
  }
  await appendMessage(orgId, conversationId, "user", message);

  const summary = formatMonthSummary(
    await computeThisMonthSummary(orgId, currentMonthStart()),
  );
  const history = await listMessages(orgId, conversationId);

  let reply: string;
  try {
    const { text } = await generateText({
      model: getAiModel(config),
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
    return Response.json(
      {
        error:
          "Gagal memanggil AI: " + (e instanceof Error ? e.message : String(e)),
        conversationId,
      },
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
}
