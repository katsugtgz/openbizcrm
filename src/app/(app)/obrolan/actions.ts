"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import {
  createGroup,
  listMembers,
  listMessages,
  openDirect,
  sendMessage,
} from "@/lib/chat/service";

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

/**
 * Auth boundary: WorkOS session IDs -> internal UUIDs (pola akuntansi/actions.ts).
 */
async function requireSession() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) throw new Error("Tidak ada organisasi aktif.");
  return { user, ...ids };
}

function fail(error: unknown): ActionResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Gagal.",
  };
}

export async function openDirectAction(
  formData: FormData,
): Promise<ActionResult & { conversationId?: string }> {
  const { userId, orgId } = await requireSession();
  const otherUserId = String(formData.get("otherUserId") ?? "").trim();
  let conversationId: string;
  try {
    conversationId = (await openDirect(userId, orgId, otherUserId))
      .conversationId;
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/obrolan");
  return { ok: true, conversationId };
}

export async function createGroupAction(
  formData: FormData,
): Promise<ActionResult & { conversationId?: string }> {
  const { userId, orgId } = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  let memberUserIds: string[] = [];
  try {
    memberUserIds = JSON.parse(
      String(formData.get("memberUserIds") ?? "[]"),
    ) as string[];
  } catch {
    return { ok: false, error: "Daftar anggota tidak valid." };
  }
  let conversationId: string;
  try {
    conversationId = (await createGroup(userId, orgId, { name, memberUserIds }))
      .id;
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/obrolan");
  return { ok: true, conversationId };
}

export async function sendMessageAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const conversationId = String(formData.get("conversationId") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  try {
    await sendMessage(userId, orgId, conversationId, body);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/obrolan");
  return { ok: true };
}

export async function listMessagesAction(conversationId: string) {
  const { userId, orgId } = await requireSession();
  return listMessages(userId, orgId, conversationId);
}

export async function listMembersAction(conversationId: string) {
  const { userId, orgId } = await requireSession();
  return listMembers(userId, orgId, conversationId);
}
