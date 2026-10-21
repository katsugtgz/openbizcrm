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
  deleteCompany,
  deleteContact,
  deleteDeal,
  getOrCreateDefaultPipeline,
  listContacts,
  moveDeal,
  updateCompany,
  updateContact,
  updateDeal,
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
      { userId },
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

export async function updateCompanyAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const industry = String(formData.get("industry") ?? "").trim() || null;
  try {
    if (!name) throw new Error("Nama perusahaan wajib diisi.");
    await updateCompany(userId, orgId, id, { name, industry });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gagal.",
    };
  }
  revalidatePath("/crm/perusahaan");
  return { ok: true };
}

export async function deleteCompanyAction(
  id: string,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await deleteCompany(userId, orgId, id);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gagal.",
    };
  }
  revalidatePath("/crm/perusahaan");
  revalidatePath("/crm");
  return { ok: true };
}

export async function updateContactAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const position = String(formData.get("position") ?? "").trim() || null;
  try {
    if (!name) throw new Error("Nama kontak wajib diisi.");
    await updateContact(userId, orgId, id, { name, email, phone, position });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gagal.",
    };
  }
  revalidatePath("/crm/perusahaan");
  return { ok: true };
}

export async function deleteContactAction(
  id: string,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await deleteContact(userId, orgId, id);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gagal.",
    };
  }
  revalidatePath("/crm/perusahaan");
  return { ok: true };
}

export async function updateDealAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const valueRaw = String(formData.get("value") ?? "").trim();
  const contactId = String(formData.get("contactId") ?? "") || null;
  try {
    if (!title) throw new Error("Judul deal wajib diisi.");
    // Nilai kosong DITOLAK (cubic pr10 crm:270): koersi diam ke 0
    // menghapus nilai deal yang sudah ada saat user tak sengaja
    // mengosongkan field. (Create tetap default 0: tak ada data tertimpa.)
    if (!valueRaw) throw new Error("Nilai deal wajib diisi.");
    await updateDeal(userId, orgId, id, {
      title,
      value: parseIDRInput(valueRaw),
      contactId,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gagal.",
    };
  }
  revalidatePath(`/crm/${id}`);
  revalidatePath("/crm");
  return { ok: true };
}

export async function deleteDealAction(id: string): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await deleteDeal(userId, orgId, id);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gagal.",
    };
  }
  revalidatePath("/crm");
  return { ok: true, redirectTo: "/crm" };
}

/** Kontak satu perusahaan untuk pemilih kontak dialog deal baru. */
export async function listCompanyContactsAction(
  companyId: string,
): Promise<{ id: string; name: string }[]> {
  const { orgId } = await requireSession();
  if (!companyId) return [];
  const rows = await listContacts(orgId, companyId);
  return rows.map((r) => ({ id: r.id, name: r.name }));
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
