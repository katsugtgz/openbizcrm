"use server";

import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { AttendanceError, checkIn, checkOut } from "@/lib/attendance/service";
import type { LatLng } from "@/lib/attendance/rules";

export type PresensiResult =
  { ok: true; message: string } | { ok: false; error: string };

/**
 * WorkOS session IDs -> internal UUIDs (cubic P1 presensi-actions). checkIn/
 * checkOut write rows keyed by the INTERNAL users.id, not session user.id.
 */
async function resolveIds() {
  const user = await session.getSession();
  if (!user) throw new AttendanceError("NOT_ALLOWED", "Belum masuk.");
  const ids = await resolveSessionIds(user);
  if (!ids) {
    throw new AttendanceError("NOT_ALLOWED", "Organisasi aktif belum dipilih.");
  }
  return ids;
}

export async function checkInAction(
  gps: LatLng | null,
): Promise<PresensiResult> {
  try {
    // ponytail: SSID tak terbaca dari browser (Web API tidak mengeksposnya);
    // Wi-Fi match aktif saat klien PWA native mengirim ssid. Upgrade: argumen
    // kedua { ssid } dari wrapper native.
    const { userId, orgId } = await resolveIds();
    const result = await checkIn({
      orgId,
      userId,
      now: new Date(),
      gps,
      ssid: null,
    });
    if (!result.result.ok) {
      return { ok: false, error: result.result.reason };
    }
    return {
      ok: true,
      message: `Presensi masuk tercatat (${result.result.status}).`,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function checkOutAction(): Promise<PresensiResult> {
  try {
    const { userId, orgId } = await resolveIds();
    const result = await checkOut({
      orgId,
      userId,
      now: new Date(),
    });
    return {
      ok: true,
      message:
        result.overtimeMinutes > 0
          ? `Presensi keluar tercatat. Lembur: ${result.overtimeMinutes} menit.`
          : "Presensi keluar tercatat.",
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
