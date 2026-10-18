/**
 * Pure month-grid helper untuk mini-calendar presensi. Tanpa db/react.
 * Minggu dimulai Senin (konvensi Indonesia).
 */

export interface CalendarDay {
  /** "YYYY-MM-DD" */
  date: string;
  /** 0 = Senin .. 6 = Minggu */
  weekday: number;
  /** false untuk padding bulan sebelum/sesudah */
  inMonth: boolean;
  /** true untuk Sabtu/Minggu */
  weekend: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Grid 6x7 hari yang mencakup bulan `month` (1-12) tahun `year`. */
export function monthDays(year: number, month: number): CalendarDay[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // Senin=1..Minggu=7 -> index 0 = Senin
  const lead = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: CalendarDay[] = [];
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  for (let i = 0; i < total; i++) {
    const d = new Date(Date.UTC(year, month - 1, 1 - lead + i));
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const weekday = (d.getUTCDay() + 6) % 7;
    cells.push({
      date,
      weekday,
      inMonth: d.getUTCMonth() === month - 1,
      weekend: weekday >= 5,
    });
  }
  return cells;
}

/** "YYYY-MM" untuk bulan sebelumnya / berikutnya. */
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
