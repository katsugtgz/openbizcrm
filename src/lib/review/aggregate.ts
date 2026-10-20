/**
 * Agregasi 360 (murni): rata-rata jawaban numerik per reviewee.
 * Hanya number dan string angka non-kosong yang dihitung — null, boolean,
 * string kosong/whitespace, dan tipe lain dilewati (bukan dihitung 0).
 * Bila `numericKeys` diberikan (key field "number" dari definisi form),
 * key lain diabaikan: jawaban tak dikenal (mis. `fakeScore`) tak bisa
 * memanipulasi rata-rata.
 */
export interface Agg360Entry {
  /** Jumlah respons terhitung. */
  count: number;
  /** Rata-rata semua nilai numerik (rata-rata per baris, lalu antarbaris). */
  average: number;
}

/** Angka valid untuk agregasi: number, atau string angka non-kosong. */
function toScore(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function aggregate360(
  rows: { revieweeUserId: string; answers: Record<string, unknown> }[],
  numericKeys?: ReadonlySet<string>,
): Map<string, Agg360Entry> {
  const sums = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    let rowSum = 0;
    let rowCount = 0;
    for (const [key, value] of Object.entries(row.answers)) {
      if (numericKeys && !numericKeys.has(key)) continue;
      const n = toScore(value);
      if (n !== null) {
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
