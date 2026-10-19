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
    // Cubic P2 quotation:44 — quantity aman × harga aman belum berarti hasil
    // aman. Cek setiap perkalian & akumulasi sebelum dipakai.
    const lineTotal = line.quantity * line.unitPrice;
    if (!Number.isSafeInteger(lineTotal)) {
      throw new MoneyError(
        "Total per baris terlalu besar (> MAX_SAFE_INTEGER).",
      );
    }
    // cubic P2 quotation:55 — faktor persen dibatasi dulu: pct/100 <= 1
    // (exact 1 saat pct=100), jadi hasil tak pernah melebihi lineTotal dan
    // 100% di dekat MAX_SAFE_INTEGER tetap exact. Bentuk lama
    // (lineTotal/100)*pct kehilangan 1 rupiah di boundary (pct=50 @ MAX-1,
    // pct=100 @ MAX-1 → total negatif).
    const discountLine = Math.round(lineTotal * (pct / 100));
    subtotal += lineTotal;
    discountTotal += discountLine;
    if (!Number.isSafeInteger(subtotal)) {
      throw new MoneyError("Subtotal terlalu besar (> MAX_SAFE_INTEGER).");
    }
    if (!Number.isSafeInteger(discountTotal)) {
      throw new MoneyError("Total diskon terlalu besar (> MAX_SAFE_INTEGER).");
    }
  }
  const total = subtotal - discountTotal;
  if (!Number.isSafeInteger(total)) {
    throw new MoneyError("Total terlalu besar (> MAX_SAFE_INTEGER).");
  }
  return { subtotal, discountTotal, total };
}
