"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { addProduct, checkout, restock } from "@/lib/pos/service";
import { parseIDRInput } from "@/lib/money";

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
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

export async function addProductAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    const initialStockRaw = String(formData.get("initialStock") ?? "").trim();
    await addProduct(userId, orgId, {
      name: String(formData.get("name") ?? ""),
      sku: String(formData.get("sku") ?? ""),
      price: parseIDRInput(String(formData.get("price") ?? "")),
      initialStock: initialStockRaw ? Number(initialStockRaw) : 0,
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/pos");
  return { ok: true };
}

export async function restockAction(formData: FormData): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await restock(
      userId,
      orgId,
      String(formData.get("productId") ?? ""),
      Number(formData.get("qty")),
    );
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/pos");
  return { ok: true };
}

export async function checkoutAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    const raw = String(formData.get("items") ?? "[]");
    const parsed = JSON.parse(raw) as { productId: string; qty: string }[];
    const taxRaw = String(formData.get("taxPct") ?? "0").trim();
    const result = await checkout(userId, orgId, {
      items: parsed
        .filter((i) => i.productId && Number(i.qty) > 0)
        .map((i) => ({ productId: i.productId, qty: Number(i.qty) })),
      paymentMethod: String(formData.get("paymentMethod") ?? "cash") as
        "cash" | "transfer" | "qris",
      taxPct: taxRaw ? Number(taxRaw) : 0,
      date: String(formData.get("date") ?? ""),
    });
    revalidatePath("/pos");
    revalidatePath("/akuntansi");
    revalidatePath("/akuntansi/laporan");
    return { ok: true, message: `Struk ${result.sale.saleNumber} terbit.` };
  } catch (error) {
    return fail(error);
  }
}
