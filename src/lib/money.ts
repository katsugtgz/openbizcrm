export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/**
 * Format integer IDR: formatIDR(1500000) => "Rp1.500.000".
 * Rupiah utuh, tanpa desimal (IDR tidak punya pecahan beredar).
 */
export function formatIDR(amount: number): string {
  if (!Number.isInteger(amount)) {
    throw new MoneyError("Jumlah harus angka bulat (integer).");
  }
  if (amount > Number.MAX_SAFE_INTEGER) {
    throw new MoneyError("Jumlah terlalu besar (> Number.MAX_SAFE_INTEGER).");
  }
  const sign = amount < 0 ? "-" : "";
  const digits = Math.abs(amount).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}Rp${grouped}`;
}

/**
 * Parse input IDR: hanya digit (pemisah/desimal/mata uang ditolak).
 * parseIDRInput("1500000") => 1500000; input lain => MoneyError.
 */
export function parseIDRInput(input: string): number {
  if (!/^\d+$/.test(input)) {
    throw new MoneyError("Input harus hanya berisi angka (digit).");
  }
  const amount = Number(input);
  if (amount > Number.MAX_SAFE_INTEGER) {
    throw new MoneyError("Jumlah terlalu besar (> Number.MAX_SAFE_INTEGER).");
  }
  return amount;
}

/**
 * Guard angka rupiah dari sumber non-UI (import Excel, API, seed): wajib
 * integer aman, non-negatif. Melempar MoneyError kalau tidak.
 */
export function assertSafeAmount(amount: number, label = "Jumlah"): number {
  if (!Number.isInteger(amount)) {
    throw new MoneyError(`${label} harus angka bulat (integer).`);
  }
  if (amount < 0) {
    throw new MoneyError(`${label} tidak boleh negatif.`);
  }
  if (amount > Number.MAX_SAFE_INTEGER) {
    throw new MoneyError(`${label} terlalu besar (> Number.MAX_SAFE_INTEGER).`);
  }
  return amount;
}
