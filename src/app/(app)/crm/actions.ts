"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import {
  createActivity,
  createCompany,
  createContact,
  createDeal,
  getOrCreateDefaultPipeline,
  moveDeal,
} from "@/lib/repos/crm-repo";
import { closeDeal, setQuotationStatus } from "@/lib/deals/service";
import { parseIDRInput } from "@/lib/money";

export interface ActionResult {
  ok: boolean;
  error?: string;
  redirectTo?: string;
}

/**
 * Auth boundary: WorkOS session IDs -> internal UUIDs (cubic P0 crm:50).
 * requireOrgRole/repos accept database UUIDs only; session user.id/orgId
 * are WorkOS "user_…"/"org_…" values and fail the UUID contract.
 */
async function requireSession() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) throw new Error("Tidak ada organisasi aktif.");
  return { user, ...ids };
}

export async function createCompanyAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const industry = String(formData.get("industry") ?? "").trim() || null;
  try {
    if (!name) throw new Error("Nama perusahaan wajib diisi.");
    await createCompany(userId, orgId, { name, industry });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gagal.",
    };
  }
  revalidatePath("/crm");
  revalidatePath("/crm/perusahaan");
  return { ok: true };
}

export async function createContactAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const companyId = String(formData.get("companyId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const position = String(formData.get("position") ?? "").trim() || null;
  try {
    if (!name) throw new Error("Nama kontak wajib diisi.");
    await createContact(userId, orgId, {
      companyId,
      name,
      email,
      phone,
      position,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gagal.",
    };
  }
  revalidatePath("/crm/perusahaan");
  return { ok: true };
}

export async function createDealAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const companyId = String(formData.get("companyId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const contactId = String(formData.get("contactId") ?? "") || null;
  const valueRaw = String(formData.get("value") ?? "").trim();
  try {
    if (!title) throw new Error("Judul deal wajib diisi.");
    const value = valueRaw ? parseIDRInput(valueRaw) : 0;
    const { pipeline, stages } = await getOrCreateDefaultPipeline(
      orgId,
      companyId,
    );
    const deal = await createDeal(userId, orgId, {
      pipelineId: pipeline.id,
      stageId: stages[0].id,
      companyId,
      contactId,
      title,
      value,
    });
    revalidatePath("/crm");
    return { ok: true, redirectTo: `/crm/${deal.id}` };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gagal.",
    };
  }
}

export async function moveDealAction(
  dealId: string,
  stageId: string,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await moveDeal(userId, orgId, dealId, stageId);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gagal.",
    };
  }
  revalidatePath("/crm");
  return { ok: true };
}

export async function setQuotationAction(
  dealId: string,
  next: string,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await setQuotationStatus(
      userId,
      orgId,
      dealId,
      next as "draft" | "sent" | "accepted" | "rejected",
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gagal.",
    };
  }
  revalidatePath(`/crm/${dealId}`);
  return { ok: true };
}

export async function closeDealAction(
  dealId: string,
  outcome: string,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await closeDeal(userId, orgId, dealId, outcome as "won" | "lost");
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gagal.",
    };
  }
  revalidatePath(`/crm/${dealId}`);
  revalidatePath("/crm");
  return { ok: true };
}

export async function createActivityAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const dealId = String(formData.get("dealId") ?? "");
  const type = String(formData.get("type") ?? "note");
  const content = String(formData.get("content") ?? "").trim();
  try {
    if (!content) throw new Error("Isi aktivitas wajib diisi.");
    await createActivity(userId, orgId, {
      dealId,
      type: type as "call" | "task" | "meeting" | "note",
      content,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gagal.",
    };
  }
  revalidatePath(`/crm/${dealId}`);
  return { ok: true };
}
