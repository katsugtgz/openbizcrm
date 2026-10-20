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
  try {
    const body = (await request.json()) as { message?: unknown };
    message = typeof body.message === "string" ? body.message.trim() : "";
  } catch {
    return Response.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }
  if (!message) {
    return Response.json({ error: "Pesan wajib diisi." }, { status: 400 });
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

  const conversation = await createConversation(userId, orgId);
  await appendMessage(orgId, conversation.id, "user", message);

  const summary = formatMonthSummary(
    await computeThisMonthSummary(orgId, currentMonthStart()),
  );
  const history = await listMessages(orgId, conversation.id);

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
        conversationId: conversation.id,
      },
      { status: 502 },
    );
  }

  const assistant = await appendMessage(
    orgId,
    conversation.id,
    "assistant",
    reply,
  );
  return Response.json({
    conversationId: conversation.id,
    reply: assistant.content,
    summary,
  });
}
