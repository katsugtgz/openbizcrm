"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import {
  closePeriod,
  createAccount,
  createJournalEntry,
  postEntry,
} from "@/lib/accounting/service";
import {
  addAsset,
  dispose,
  runMonthlyDepreciation,
} from "@/lib/assets/service";
import { parseIDRInput } from "@/lib/money";

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

/**
 * Auth boundary: WorkOS session IDs -> internal UUIDs (pola crm/actions.ts).
 * requireOrgRole/repos menerima UUID database saja.
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

export async function createAccountAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "asset");
  try {
    await createAccount(userId, orgId, {
      code,
      name,
      type: type as "asset" | "liability" | "equity" | "revenue" | "expense",
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/akuntansi");
  revalidatePath("/akuntansi/jurnal");
  return { ok: true };
}

/**
 * Baris jurnal dikirim sebagai JSON string (state klien dinamis). Bentuk
 * divalidasi di boundary: JSON tak valid / bukan array / baris tak berbentuk
 * ditolak dengan pesan jelas, bukan TypeError mentah.
 */
export async function createJournalEntryAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const date = String(formData.get("date") ?? "");
  const description = String(formData.get("description") ?? "").trim() || null;
  try {
    const raw = String(formData.get("lines") ?? "[]");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Baris jurnal tidak valid (bukan JSON).");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("Baris jurnal harus array.");
    }
    // Baris kosong form dinamis (accountId "") dilewati; baris MALFORMED
    // (bukan objek / accountId bukan string) DITOLAK eksplisit — diam-diam
    // membuangnya mengunbalance jurnal (cubic pr10 akuntansi:88).
    const lines: { accountId: string; debit: number; credit: number }[] = [];
    for (const entry of parsed) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof (entry as { accountId?: unknown }).accountId !== "string"
      ) {
        throw new Error("Baris jurnal tidak valid.");
      }
      const e = entry as {
        accountId: string;
        debit?: unknown;
        credit?: unknown;
      };
      if (e.accountId === "") continue;
      lines.push({
        accountId: e.accountId,
        debit: e.debit ? parseIDRInput(String(e.debit)) : 0,
        credit: e.credit ? parseIDRInput(String(e.credit)) : 0,
      });
    }
    await createJournalEntry(userId, orgId, {
      date,
      description,
      lines,
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/akuntansi");
  revalidatePath("/akuntansi/jurnal");
  return { ok: true };
}

export async function postEntryAction(entryId: string): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await postEntry(userId, orgId, entryId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/akuntansi");
  revalidatePath("/akuntansi/jurnal");
  revalidatePath("/akuntansi/buku-besar");
  revalidatePath("/akuntansi/laporan");
  return { ok: true };
}

export async function closePeriodAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const yearMonth = String(formData.get("period") ?? "");
  try {
    await closePeriod(userId, orgId, yearMonth);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/akuntansi");
  revalidatePath("/akuntansi/jurnal");
  return { ok: true };
}

export async function addAssetAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    const cost = parseIDRInput(String(formData.get("cost") ?? ""));
    const salvageRaw = String(formData.get("salvageValue") ?? "").trim();
    await addAsset(userId, orgId, {
      name: String(formData.get("name") ?? ""),
      cost,
      salvageValue: salvageRaw ? parseIDRInput(salvageRaw) : 0,
      usefulLifeMonths: Number(formData.get("usefulLifeMonths")),
      acquiredDate: String(formData.get("acquiredDate") ?? ""),
      depreciationExpenseAccountId: String(
        formData.get("depreciationExpenseAccountId") ?? "",
      ),
      accumulatedDepreciationAccountId: String(
        formData.get("accumulatedDepreciationAccountId") ?? "",
      ),
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/akuntansi/aset");
  return { ok: true };
}

export async function runDepreciationAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const periodEnd = String(formData.get("periodEnd") ?? "");
  try {
    const result = await runMonthlyDepreciation(userId, orgId, periodEnd);
    revalidatePath("/akuntansi/aset");
    revalidatePath("/akuntansi");
    revalidatePath("/akuntansi/laporan");
    return {
      ok: true,
      message: `${result.processed} aset, total Rp${result.totalAmount.toLocaleString("id-ID")}.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function disposeAssetAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await dispose(
      userId,
      orgId,
      String(formData.get("assetId") ?? ""),
      String(formData.get("disposalDate") ?? ""),
      {
        assetAccountId: String(formData.get("assetAccountId") ?? ""),
        lossAccountId: String(formData.get("lossAccountId") ?? ""),
      },
    );
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/akuntansi/aset");
  return { ok: true };
}
