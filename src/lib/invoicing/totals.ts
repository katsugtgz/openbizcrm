import { MoneyError, assertSafeAmount } from "@/lib/money";

/**
 * Pure invoice/POS totals — TIDAK menyentuh DB. Semua nominal rupiah integer
 * aman; tax = floor(subtotal * taxPct / 100).
 */

export class TotalsError extends MoneyError {}

function assertInt(v: number, label: string): number {
  if (!Number.isInteger(v)) {
    throw new TotalsError(`${label} harus angka bulat (integer).`);
  }
  return v;
}

function assertSafeInt(v: number, label: string): number {
  assertInt(v, label);
  if (Math.abs(v) > Number.MAX_SAFE_INTEGER) {
    throw new TotalsError(
      `${label} terlalu besar (> Number.MAX_SAFE_INTEGER).`,
    );
  }
  return v;
}

/**
 * Pajak = floor(subtotal * taxPct / 100), presisi penuh via BigInt (oracle).
 * Bentuk float (naif maupun divide-first) keduanya salah di beberapa titik:
 * naif meleset saat s*p melewati 2^53 (mis. s=MAX, p=79 → +1), divide-first
 * meleset di nilai kecil saat pembagian float memotong (mis. 29×100% → 28
 * bukannya 29). BigInt aman: subtotal ≤ 2^53-1 dan pct ≤ 100, hasil selalu
 * di bawah 2^53 (terverifikasi oracle di totals.test.ts).
 */
export function floorTax(subtotal: number, taxPct: number): number {
  assertSafeAmount(subtotal, "Subtotal");
  assertInt(taxPct, "Persentase pajak");
  if (taxPct < 0 || taxPct > 100) {
    throw new TotalsError("Persentase pajak harus 0..100.");
  }
  if (taxPct === 0 || subtotal === 0) return 0;
  const tax = (BigInt(subtotal) * BigInt(taxPct)) / 100n;
  return Number(tax);
}

export interface TotalsResult {
  /** qty * unitPrice (dibatasi MAX_SAFE). */
  lineTotal: number;
  subtotal: number;
  taxAmount: number;
  total: number;
}

/** Satu baris invoice/POS item: validasi qty/unitPrice + hitung total. */
const QTY_DB_MAX = 2_147_483_647; // kolom DB pos_sale_items/invoice_items integer PG

/** Satu baris invoice/POS item: validasi qty/unitPrice + hitung total. */
export function computeLineTotals(
  qty: number,
  unitPrice: number,
  taxPct = 0,
): TotalsResult {
  assertInt(qty, "Jumlah (qty)");
  if (qty <= 0) {
    throw new TotalsError("Jumlah (qty) harus > 0.");
  }
  if (qty > QTY_DB_MAX) {
    throw new TotalsError(
      `Jumlah (qty) melebihi batas kolom DB (max ${QTY_DB_MAX}).`,
    );
  }
  assertSafeAmount(unitPrice, "Harga satuan");
  const product = qty * unitPrice;
  if (!Number.isSafeInteger(product)) {
    throw new TotalsError(
      "Hasil qty * unitPrice melebihi Number.MAX_SAFE_INTEGER.",
    );
  }
  const subtotal = product;
  const taxAmount = floorTax(subtotal, taxPct);
  const total = assertSafeInt(subtotal + taxAmount, "Total");
  return { lineTotal: subtotal, subtotal, taxAmount, total };
}
