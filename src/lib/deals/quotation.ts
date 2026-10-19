import { assertSafeAmount, MoneyError } from "@/lib/money";

export interface QuotationLine {
  description: string;
  /** Jumlah unit, integer >= 1. */
  quantity: number;
  /** Harga satuan, rupiah integer >= 0. */
  unitPrice: number;
  /** Diskon persen per baris, 0..100. Default 0. */
  discountPercent?: number;
}

export interface QuotationTotals {
  /** Sum(quantity * unitPrice). */
  subtotal: number;
  /** Sum diskon baris, dibulatkan ke rupiah terdekat. */
  discountTotal: number;
  /** Subtotal minus diskon. */
  total: number;
}

/**
 * Hitung total quotation (pure). Melempar MoneyError untuk input tak valid:
 * quantity bukan integer >= 1, unitPrice bukan integer >= 0, discount di
 * luar 0..100, atau daftar item kosong.
 */
export function calculateQuotationTotals(
  lines: QuotationLine[],
): QuotationTotals {
  if (lines.length === 0) {
    throw new MoneyError("Quotation minimal memiliki satu item.");
  }
  let subtotal = 0;
  let discountTotal = 0;
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new MoneyError("Quantity harus integer >= 1.");
    }
    assertSafeAmount(line.unitPrice, "Harga satuan");
    const pct = line.discountPercent ?? 0;
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new MoneyError("Diskon harus di antara 0 dan 100.");
    }
    const lineTotal = line.quantity * line.unitPrice;
    subtotal += lineTotal;
    discountTotal += Math.round((lineTotal * pct) / 100);
  }
  return { subtotal, discountTotal, total: subtotal - discountTotal };
}
