/**
 * Attendance service: the only DB-facing layer for presensi. Resolves the
 * caller's employee + branch context, asks the pure rules engine for the
 * verdict, then persists to `attendances` (upsert per employee+date) and
 * writes an audit log. Org scoping rides on the employee row itself.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendances, employees, officeWifi, shifts } from "@/db/schema";
import { recordAudit } from "@/lib/repos/audit-repo";
import {
  evaluateCheckIn,
  computeOvertimeMinutes,
  jakartaDateISO,
  type CheckInResult,
  type LatLng,
} from "./rules";

export class AttendanceError extends Error {
  constructor(
    code:
      | "NO_EMPLOYEE"
      | "NO_SHIFT"
      | "NOT_ALLOWED"
      | "ALREADY_CHECKED_IN"
      | "NO_OPEN_ATTENDANCE",
    message: string,
  ) {
    super(message);
    this.name = "AttendanceError";
    this.code = code;
  }
  code!: string;
}

async function getEmployeeByUser(orgId: string, userId: string) {
  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.orgId, orgId), eq(employees.userId, userId)))
    .limit(1);
  return employee ?? null;
}

async function getOrgShift(orgId: string) {
  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.orgId, orgId))
    .limit(1);
  return shift ?? null;
}

async function getAllowedSsids(orgId: string, branchId: string | null) {
  const rows = await db
    .select({ ssid: officeWifi.ssid })
    .from(officeWifi)
    .where(
      branchId
        ? and(eq(officeWifi.orgId, orgId), eq(officeWifi.branchId, branchId))
        : eq(officeWifi.orgId, orgId),
    );
  return rows.map((r) => r.ssid);
}

async function getOfficePoint(branchId: string | null): Promise<LatLng | null> {
  // Office coordinates come from the branch row when present. Branches have
  // no lat/lon columns; for now the office point is null so GPS is skipped
  // and Wi-Fi decides. ponytail: add branch.lat/lon columns when GPS-first
  // branches are needed; upgrade path is a nullable column + this lookup.
  void branchId;
  return null;
}

export interface CheckInParams {
  orgId: string;
  userId: string;
  now: Date;
  gps: LatLng | null;
  ssid: string | null;
}

/**
 * Check-in for today (WIB). Rules verdict decides method/status; the row is
 * created once, later attempts with a row already open are rejected.
 */
export async function checkIn(
  params: CheckInParams,
): Promise<{ attendanceId: string; result: CheckInResult }> {
  const employee = await getEmployeeByUser(params.orgId, params.userId);
  if (!employee) {
    throw new AttendanceError(
      "NO_EMPLOYEE",
      "Anda tidak terdaftar sebagai karyawan di organisasi ini.",
    );
  }
  const shift = await getOrgShift(params.orgId);
  if (!shift) {
    throw new AttendanceError(
      "NO_SHIFT",
      "Shift belum dikonfigurasi untuk organisasi ini.",
    );
  }

  const dateISO = jakartaDateISO(params.now);
  const existing = await db
    .select({ id: attendances.id, checkInAt: attendances.checkInAt })
    .from(attendances)
    .where(
      and(
        eq(attendances.employeeId, employee.id),
        eq(attendances.date, dateISO),
      ),
    )
    .limit(1);
  if (existing[0]?.checkInAt) {
    throw new AttendanceError(
      "ALREADY_CHECKED_IN",
      "Anda sudah melakukan presensi masuk hari ini.",
    );
  }

  const [wfhRow] = await db
    .select({ id: attendances.id })
    .from(attendances)
    .where(
      and(
        eq(attendances.employeeId, employee.id),
        eq(attendances.date, dateISO),
        eq(attendances.status, "wfh"),
      ),
    )
    .limit(1);

  const verdict = evaluateCheckIn({
    now: params.now,
    shift,
    office: await getOfficePoint(employee.branchId),
    gps: params.gps,
    ssid: params.ssid,
    allowedSsids: await getAllowedSsids(params.orgId, employee.branchId),
    wfh: Boolean(wfhRow),
    holidayDates: [],
  });
  if (!verdict.ok) {
    throw new AttendanceError("NOT_ALLOWED", verdict.reason);
  }

  const [row] = existing.length
    ? await db
        .update(attendances)
        .set({
          checkInAt: params.now,
          method: verdict.method,
          status: verdict.status,
        })
        .where(eq(attendances.id, existing[0].id))
        .returning()
    : await db
        .insert(attendances)
        .values({
          orgId: params.orgId,
          employeeId: employee.id,
          date: dateISO,
          checkInAt: params.now,
          method: verdict.method,
          status: verdict.status,
        })
        .returning();

  await recordAudit({
    orgId: params.orgId,
    userId: params.userId,
    action: "attendance.check_in",
    entity: "attendance",
    entityId: row.id,
    metadata: { method: verdict.method, status: verdict.status },
  });
  return { attendanceId: row.id, result: verdict };
}

/**
 * Check-out for today: requires an open check-in, computes overtime from
 * the shift end (threshold-aware).
 */
export async function checkOut(params: {
  orgId: string;
  userId: string;
  now: Date;
}): Promise<{ attendanceId: string; overtimeMinutes: number }> {
  const employee = await getEmployeeByUser(params.orgId, params.userId);
  if (!employee) {
    throw new AttendanceError(
      "NO_EMPLOYEE",
      "Anda tidak terdaftar sebagai karyawan di organisasi ini.",
    );
  }
  const shift = await getOrgShift(params.orgId);
  if (!shift) {
    throw new AttendanceError(
      "NO_SHIFT",
      "Shift belum dikonfigurasi untuk organisasi ini.",
    );
  }

  const dateISO = jakartaDateISO(params.now);
  const [row] = await db
    .select({ id: attendances.id, checkInAt: attendances.checkInAt })
    .from(attendances)
    .where(
      and(
        eq(attendances.employeeId, employee.id),
        eq(attendances.date, dateISO),
      ),
    )
    .limit(1);
  if (!row?.checkInAt) {
    throw new AttendanceError(
      "NO_OPEN_ATTENDANCE",
      "Presensi masuk belum ada; presensi keluar ditolak.",
    );
  }

  const overtimeMinutes =
    computeOvertimeMinutes(params.now, shift.endTime) ?? 0;
  await db
    .update(attendances)
    .set({ checkOutAt: params.now, overtimeMinutes })
    .where(eq(attendances.id, row.id));
  await recordAudit({
    orgId: params.orgId,
    userId: params.userId,
    action: "attendance.check_out",
    entity: "attendance",
    entityId: row.id,
    metadata: { overtimeMinutes },
  });
  return { attendanceId: row.id, overtimeMinutes };
}
