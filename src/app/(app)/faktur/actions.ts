"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import {
  cancelInvoice,
  createInvoice,
  markOverdue,
  recordPayment,
  sendInvoice,
} from "@/lib/invoicing/service";
import { parseIDRInput } from "@/lib/money";

export interface ActionResult {
  ok: boolean;
  error?: string;
  redirectTo?: string;
}

async function requireSession() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) throw new Error("Tidak ada organisasi aktif.");
  return { user, ...ids };
}

function fail(error: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Gagal.",
  };
}

export async function createInvoiceAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    const raw = String(formData.get("items") ?? "[]");
    const parsed = JSON.parse(raw) as {
      description: string;
      qty: string;
      unitPrice: string;
    }[];
    const items = parsed
      .filter((i) => i.description.trim())
      .map((i) => ({
        description: i.description,
        qty: Number(i.qty),
        unitPrice: parseIDRInput(i.unitPrice),
      }));
    const taxRaw = String(formData.get("taxPct") ?? "0").trim();
    const { invoice } = await createInvoice(userId, orgId, {
      companyId: String(formData.get("companyId") ?? ""),
      contactId: String(formData.get("contactId") ?? "") || null,
      issueDate: String(formData.get("issueDate") ?? ""),
      dueDate: String(formData.get("dueDate") ?? ""),
      taxPct: taxRaw ? Number(taxRaw) : 0,
      notes: String(formData.get("notes") ?? "").trim() || null,
      items,
    });
    revalidatePath("/faktur");
    return { ok: true, redirectTo: `/faktur/${invoice.id}` };
  } catch (error) {
    return fail(error);
  }
}

export async function sendInvoiceAction(
  invoiceId: string,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await sendInvoice(userId, orgId, invoiceId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/faktur");
  revalidatePath(`/faktur/${invoiceId}`);
  revalidatePath("/akuntansi");
  revalidatePath("/akuntansi/laporan");
  return { ok: true };
}

export async function recordPaymentAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  try {
    await recordPayment(userId, orgId, invoiceId, {
      amount: parseIDRInput(String(formData.get("amount") ?? "")),
      method: String(formData.get("method") ?? "transfer") as
        "cash" | "transfer" | "qris",
      paidAt: String(formData.get("paidAt") ?? ""),
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/faktur");
  revalidatePath(`/faktur/${invoiceId}`);
  revalidatePath("/akuntansi");
  revalidatePath("/akuntansi/laporan");
  return { ok: true };
}

export async function markOverdueAction(
  invoiceId: string,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await markOverdue(userId, orgId, invoiceId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/faktur");
  revalidatePath(`/faktur/${invoiceId}`);
  return { ok: true };
}

export async function cancelInvoiceAction(
  invoiceId: string,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await cancelInvoice(userId, orgId, invoiceId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/faktur");
  revalidatePath(`/faktur/${invoiceId}`);
  return { ok: true };
}
