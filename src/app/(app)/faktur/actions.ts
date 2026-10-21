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
import { assertISODate } from "@/lib/accounting/engine";
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

/**
 * Normalisasi tanggal form ke "YYYY-MM-DD" kalender (cubic pr8 actions:60 —
 * createInvoice membandingkan string; input tak valid/offset-zona harus
 * ditolak di boundary, bukan lolos lewat lexical compare). Memakai guard
 * bersama yang juga menolak hari tak nyata (2026-02-30 lolos Date.parse).
 */
function normalizeDate(raw: FormDataEntryValue | null, label: string): string {
  return assertISODate(String(raw ?? "").trim(), label);
}

export async function createInvoiceAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    const raw = String(formData.get("items") ?? "[]");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Item invoice tidak valid (bukan JSON).");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("Item invoice harus array.");
    }
    // Baris kosong form dinamis (deskripsi kosong/whitespace) dilewati;
    // entri MALFORMED (bukan objek / deskripsi bukan string) DITOLAK
    // eksplisit — diam-diam membuangnya salah menagih pelanggan
    // (cubic pr10 faktur:65).
    const items: { description: string; qty: number; unitPrice: number }[] = [];
    for (const entry of parsed) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof (entry as { description?: unknown }).description !== "string"
      ) {
        throw new Error("Baris invoice tidak valid.");
      }
      const e = entry as {
        description: string;
        qty?: unknown;
        unitPrice?: unknown;
      };
      if (e.description.trim() === "") continue;
      // Strictly typed qty/price: Number(true) === 1 and Number("") === 0,
      // so blind coercion turns malformed JSON into a wrong invoice.
      // Accept digit-strings or numbers only.
      if (typeof e.qty !== "string" && typeof e.qty !== "number") {
        throw new Error("Kuantitas invoice tidak valid.");
      }
      const qtyText = typeof e.qty === "number" ? String(e.qty) : e.qty.trim();
      if (!/^\d+$/.test(qtyText)) {
        throw new Error("Kuantitas invoice tidak valid.");
      }
      const qty = Number(qtyText);
      if (!Number.isSafeInteger(qty) || qty < 1) {
        throw new Error("Kuantitas invoice tidak valid.");
      }
      if (typeof e.unitPrice !== "string" && typeof e.unitPrice !== "number") {
        throw new Error("Harga invoice tidak valid.");
      }
      items.push({
        description: e.description,
        qty,
        unitPrice: parseIDRInput(String(e.unitPrice)),
      });
    }
    const taxRaw = String(formData.get("taxPct") ?? "0").trim();
    const { invoice } = await createInvoice(userId, orgId, {
      companyId: String(formData.get("companyId") ?? ""),
      contactId: String(formData.get("contactId") ?? "") || null,
      issueDate: normalizeDate(formData.get("issueDate"), "Tanggal terbit"),
      dueDate: normalizeDate(formData.get("dueDate"), "Jatuh tempo"),
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
      paidAt: normalizeDate(formData.get("paidAt"), "Tanggal bayar"),
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
