/**
 * Agregasi 360 (murni): rata-rata semua jawaban numerik per reviewee.
 * Angka string di-koersi (jawaban datang dari JSON bebas tipe); baris tanpa
 * angka valid dilewati, bukan dihitung 0 — menengahi rata-rata.
 */
export interface Agg360Entry {
  /** Jumlah respons terhitung. */
  count: number;
  /** Rata-rata semua nilai numerik, dibulatkan 2 desimal. */
  average: number;
}

export function aggregate360(
  rows: { revieweeUserId: string; answers: Record<string, unknown> }[],
): Map<string, Agg360Entry> {
  const sums = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    let rowSum = 0;
    let rowCount = 0;
    for (const value of Object.values(row.answers)) {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isFinite(n)) {
        rowSum += n;
        rowCount += 1;
      }
    }
    if (rowCount === 0) continue;
    const acc = sums.get(row.revieweeUserId) ?? { sum: 0, count: 0 };
    acc.sum += rowSum / rowCount;
    acc.count += 1;
    sums.set(row.revieweeUserId, acc);
  }
  const out = new Map<string, Agg360Entry>();
  for (const [userId, { sum, count }] of sums) {
    out.set(userId, {
      count,
      average: Math.round((sum / count) * 100) / 100,
    });
  }
  return out;
}
