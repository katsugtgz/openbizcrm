/**
 * Pure attendance check-in rules. No db/react imports.
 * Waktu Jakarta = UTC+7 fixed (tanpa DST).
 */

export const DEFAULT_GRACE_MINUTES = 15;
export const DEFAULT_OVERTIME_THRESHOLD_MINUTES = 60;
export const DEFAULT_RADIUS_M = 150;

export interface LatLng {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function isWithinRadius(
  center: LatLng,
  point: LatLng,
  radiusMeters: number,
): boolean {
  return haversineMeters(center, point) <= radiusMeters;
}

/** Exact match, case-insensitive. */
export function wifiMatches(
  ssid: string | null,
  allowedSsids: string[],
): boolean {
  if (!ssid || allowedSsids.length === 0) return false;
  const lower = ssid.toLowerCase();
  return allowedSsids.some((s) => s.toLowerCase() === lower);
}

const JAKARTA_OFFSET_MINUTES = 7 * 60;

/** Menit sejak tengah malam WIB. */
export function jakartaMinutes(date: Date): number {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (utcMinutes + JAKARTA_OFFSET_MINUTES) % 1440;
}

/** Tanggal kalender WIB "YYYY-MM-DD". */
export function jakartaDateISO(date: Date): string {
  const shifted = new Date(date.getTime() + JAKARTA_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function isLate(
  minutes: number,
  shiftStartMinutes: number,
  graceMinutes: number,
): boolean {
  return minutes > shiftStartMinutes + graceMinutes;
}

export function isHoliday(dateISO: string, holidayDates: string[]): boolean {
  return holidayDates.includes(dateISO);
}

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export interface CheckInInput {
  now: Date;
  shift: { startTime: string; endTime: string };
  office: LatLng | null;
  gps: LatLng | null;
  ssid: string | null;
  allowedSsids: string[];
  wfh: boolean;
  holidayDates: string[];
}

export type CheckInResult =
  | {
      ok: true;
      status: "ontime" | "late" | "wfh";
      method: "gps" | "wifi" | "manual";
    }
  | { ok: false; reason: string };

export function evaluateCheckIn(input: CheckInInput): CheckInResult {
  const dateISO = jakartaDateISO(input.now);
  if (isHoliday(dateISO, input.holidayDates)) {
    return { ok: false, reason: `Hari libur (${dateISO}).` };
  }
  if (input.wfh) {
    return { ok: true, status: "wfh", method: "manual" };
  }
  const minutes = jakartaMinutes(input.now);
  const start = parseHHMM(input.shift.startTime);
  const late = isLate(minutes, start, DEFAULT_GRACE_MINUTES);
  if (
    input.office &&
    input.gps &&
    isWithinRadius(input.office, input.gps, DEFAULT_RADIUS_M)
  ) {
    return { ok: true, status: late ? "late" : "ontime", method: "gps" };
  }
  if (wifiMatches(input.ssid, input.allowedSsids)) {
    return { ok: true, status: late ? "late" : "ontime", method: "wifi" };
  }
  return { ok: false, reason: "Di luar radius kantor dan Wi-Fi tidak cocok." };
}

/**
 * Menit lembur = kotor setelah shift berakhir dikurangi threshold.
 * Checkout hilang => null. Di bawah/tepat threshold => 0.
 */
export function computeOvertimeMinutes(
  checkOutAt: Date | null,
  shiftEndTime: string,
  thresholdMinutes: number = DEFAULT_OVERTIME_THRESHOLD_MINUTES,
): number | null {
  if (!checkOutAt) return null;
  // ponytail: checkout sebelum tengah malam saja; shift malam lintas hari
  // butuh tanggal checkout eksplisit — tambahkan saat shift malam ada.
  const after = jakartaMinutes(checkOutAt) - parseHHMM(shiftEndTime);
  return Math.max(0, after - thresholdMinutes);
}
