"use server";

import { session } from "@/lib/auth";
import { getUser } from "@/lib/repos/user-repo";
import { AttendanceError, checkIn, checkOut } from "@/lib/attendance/service";
import type { LatLng } from "@/lib/attendance/rules";

export type PresensiResult =
  { ok: true; message: string } | { ok: false; error: string };

/** Resolve org from the signed-in user's currentOrgId (seed/dev flow). */
async function currentOrgId(): Promise<string> {
  const user = await session.getSession();
  if (!user) throw new AttendanceError("NOT_ALLOWED", "Belum masuk.");
  const dbUser = await getUser(user.id);
  const orgId = dbUser?.currentOrgId;
  if (!orgId) {
    throw new AttendanceError("NOT_ALLOWED", "Organisasi aktif belum dipilih.");
  }
  return orgId;
}

export async function checkInAction(
  gps: LatLng | null,
): Promise<PresensiResult> {
  try {
    // ponytail: SSID tak terbaca dari browser (Web API tidak mengeksposnya);
    // Wi-Fi match aktif saat klien PWA native mengirim ssid. Upgrade: argumen
    // kedua { ssid } dari wrapper native.
    const orgId = await currentOrgId();
    const user = await session.getSession();
    const result = await checkIn({
      orgId,
      userId: user!.id,
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
    const orgId = await currentOrgId();
    const user = await session.getSession();
    const result = await checkOut({
      orgId,
      userId: user!.id,
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
