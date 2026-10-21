import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendances,
  branches,
  departments,
  employees,
  leaveBalances,
  leaveRequests,
  officeWifi,
  orgMemberships,
  positions,
  shifts,
} from "@/db/schema";
import {
  NotFoundError,
  OrgScopeError,
  assertInternalId,
  requireOrgRole,
} from "@/lib/org-scope";
import { assertSafeAmount } from "@/lib/money";
import { recordAudit } from "@/lib/repos/audit-repo";
import { approve, createApproval, currentState, reject } from "@/lib/approval";
import {
  saveApprovalRequest,
  getApprovalRequestByRowIdForUpdate,
  saveApprovalRequestTx,
} from "@/lib/approval/store";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Department = typeof departments.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type Shift = typeof shifts.$inferSelect;
export type OfficeWifi = typeof officeWifi.$inferSelect;
export type Attendance = typeof attendances.$inferSelect;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type LeaveBalance = typeof leaveBalances.$inferSelect;

/** Tenant guard: entity milik org lain => NO_MEMBERSHIP (sama seperti repo lain). */
async function requireEmployee(
  orgId: string,
  employeeId: string,
): Promise<Employee> {
  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.orgId, orgId)))
    .limit(1);
  if (!employee) {
    throw new OrgScopeError("NO_MEMBERSHIP", "Karyawan tidak ditemukan.");
  }
  return employee;
}

/**
 * Unit organisasi (cabang/departemen/posisi) wajib milik org yang sama —
 * id lintas-org ditolak sebelum insert/update agar karyawan tidak bisa
 * ditempel ke unit org lain (pola createOfficeWifi).
 */
async function requireOrgUnit(
  orgId: string,
  unit: "branch" | "department" | "position",
  id: string,
): Promise<void> {
  const table =
    unit === "branch"
      ? branches
      : unit === "department"
        ? departments
        : positions;
  const label =
    unit === "branch"
      ? "Cabang"
      : unit === "department"
        ? "Departemen"
        : "Posisi";
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.orgId, orgId)))
    .limit(1);
  if (!row) {
    throw new OrgScopeError("NO_MEMBERSHIP", `${label} tidak ditemukan.`);
  }
}

async function requireEmployeeUnits(
  orgId: string,
  input: {
    branchId?: string | null;
    departmentId?: string | null;
    positionId?: string | null;
  },
): Promise<void> {
  if (input.branchId) await requireOrgUnit(orgId, "branch", input.branchId);
  if (input.departmentId)
    await requireOrgUnit(orgId, "department", input.departmentId);
  if (input.positionId)
    await requireOrgUnit(orgId, "position", input.positionId);
}

// ---------------- Departments / Positions ----------------

export async function listDepartments(orgId: string): Promise<Department[]> {
  return db
    .select()
    .from(departments)
    .where(eq(departments.orgId, orgId))
    .orderBy(departments.name);
}

export async function createDepartment(
  userId: string,
  orgId: string,
  input: { name: string },
): Promise<Department> {
  await requireOrgRole(userId, orgId, "admin");
  const [row] = await db
    .insert(departments)
    .values({ orgId, name: input.name })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "hrm.department.create",
    entity: "department",
    entityId: row.id,
  });
  return row;
}

export async function listPositions(orgId: string): Promise<Position[]> {
  return db
    .select()
    .from(positions)
    .where(eq(positions.orgId, orgId))
    .orderBy(positions.name);
}

export async function createPosition(
  userId: string,
  orgId: string,
  input: { name: string },
): Promise<Position> {
  await requireOrgRole(userId, orgId, "admin");
  const [row] = await db
    .insert(positions)
    .values({ orgId, name: input.name })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "hrm.position.create",
    entity: "position",
    entityId: row.id,
  });
  return row;
}

// ---------------- Employees ----------------

export interface EmployeeInput {
  branchId?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  employeeNo: string;
  name: string;
  status?: "active" | "resigned" | "suspended";
  taxStatus?: "TK0" | "TK1" | "TK2" | "TK3" | "KI0" | "KI1" | "KI2" | "KI3";
  baseSalary: number;
  /** "YYYY-MM-DD"; dipakai prorasi THR. Null = anggap 12 bulan. */
  hireDate?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  /**
   * Link ke akun user org (internal UUID): pemiliknya bisa melihat slip
   * gaji karyawan ini. Null = lepas tautan; undefined (update) = biarkan.
   */
  linkedUserId?: string | null;
}

export async function listEmployees(
  orgId: string,
  opts?: { limit?: number },
): Promise<Employee[]> {
  // Default cap: halaman karyawan me-render seluruh tabel tanpa ini.
  const limit = Math.min(Math.max(opts?.limit ?? 500, 1), 5000);
  return db
    .select()
    .from(employees)
    .where(eq(employees.orgId, orgId))
    .orderBy(employees.employeeNo)
    .limit(limit);
}

export interface PayrollStaffRow {
  id: string;
  name: string;
  taxStatus: Employee["taxStatus"];
  baseSalary: number;
  hireDate: string | null;
  status: Employee["status"];
}

/**
 * Seluruh karyawan org, TANPA cap (cubic pr10 hrm:184): satu-satunya sumber
 * untuk run + preview payroll — preview memakai listEmployees (cap 500)
 * melaporkan total kurang saat org > 500, sementara run membayar semua.
 * Kolom minimal (agregasi saja, tak pernah di-render per-baris).
 */
export async function listEmployeesForPayroll(
  orgId: string,
): Promise<PayrollStaffRow[]> {
  return db
    .select({
      id: employees.id,
      name: employees.name,
      taxStatus: employees.taxStatus,
      baseSalary: employees.baseSalary,
      hireDate: employees.hireDate,
      status: employees.status,
    })
    .from(employees)
    .where(eq(employees.orgId, orgId))
    .orderBy(employees.employeeNo);
}

export async function getEmployee(
  orgId: string,
  id: string,
): Promise<Employee | null> {
  const [row] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/**
 * Link karyawan<->user didukung penuh (cubic pr10 payslip:73): target
 * wajib member org ini (UUID internal) dan belum tertaut ke karyawan
 * lain di org yang sama. exceptEmployeeId untuk update milik sendiri.
 */
async function requireLinkableUser(
  orgId: string,
  linkedUserId: string,
  exceptEmployeeId?: string,
): Promise<void> {
  assertInternalId("userId", linkedUserId);
  const [membership] = await db
    .select({ userId: orgMemberships.userId })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.orgId, orgId),
        eq(orgMemberships.userId, linkedUserId),
      ),
    )
    .limit(1);
  if (!membership) {
    throw new NotFoundError("User tidak terdaftar di organisasi ini.");
  }
  const conds = [
    eq(employees.orgId, orgId),
    eq(employees.userId, linkedUserId),
  ];
  if (exceptEmployeeId) conds.push(ne(employees.id, exceptEmployeeId));
  const [taken] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(...conds))
    .limit(1);
  if (taken) throw new Error("User sudah tertaut ke karyawan lain.");
}

/** Link race (cek lolos bersamaan): unique index bicara terakhir. */
function throwIfLinkRace(error: unknown): never {
  if (
    error instanceof Error &&
    error.message.includes("employees_org_user_unique")
  ) {
    throw new Error("User sudah tertaut ke karyawan lain.");
  }
  throw error;
}

export async function createEmployee(
  userId: string,
  orgId: string,
  input: EmployeeInput,
): Promise<Employee> {
  await requireOrgRole(userId, orgId, "admin");
  assertSafeAmount(input.baseSalary, "Gaji pokok");
  await requireEmployeeUnits(orgId, input);
  if (input.linkedUserId) {
    await requireLinkableUser(orgId, input.linkedUserId);
  }
  let row: Employee;
  try {
    const [created] = await db
      .insert(employees)
      .values({
        orgId,
        userId: input.linkedUserId ?? null,
        branchId: input.branchId ?? null,
      departmentId: input.departmentId ?? null,
      positionId: input.positionId ?? null,
      employeeNo: input.employeeNo,
      name: input.name,
      status: input.status ?? "active",
      taxStatus: input.taxStatus ?? "TK0",
      baseSalary: input.baseSalary,
      hireDate: input.hireDate ?? null,
      bankName: input.bankName ?? null,
      bankAccount: input.bankAccount ?? null,
    })
      .returning();
    row = created;
  } catch (error) {
    throwIfLinkRace(error);
  }
  await recordAudit({
    orgId,
    userId,
    action: "hrm.employee.create",
    entity: "employee",
    entityId: row.id,
    // Metadata audit member-readable: tanpa gaji/rekening.
    metadata: { employeeNo: row.employeeNo },
  });
  return row;
}

export async function updateEmployee(
  userId: string,
  orgId: string,
  id: string,
  input: Partial<EmployeeInput>,
): Promise<Employee> {
  await requireOrgRole(userId, orgId, "admin");
  await requireEmployee(orgId, id);
  if (input.baseSalary !== undefined) {
    assertSafeAmount(input.baseSalary, "Gaji pokok");
  }
  await requireEmployeeUnits(orgId, input);
  // linkedUserId bukan nama kolom (kolomnya userId): validasi + petakan
  // eksplisit; undefined = biarkan tautan, null = lepas tautan.
  const { linkedUserId, ...rest } = input;
  if (linkedUserId) {
    await requireLinkableUser(orgId, linkedUserId, id);
  }
  let row: Employee;
  try {
    const [updated] = await db
      .update(employees)
      .set(
        linkedUserId === undefined ? rest : { ...rest, userId: linkedUserId },
      )
      .where(and(eq(employees.id, id), eq(employees.orgId, orgId)))
      .returning();
    row = updated;
  } catch (error) {
    throwIfLinkRace(error);
  }
  // Metadata audit member-readable: input mentah bisa memuat gaji pokok
  // dan rekening — selalu strip field sensitif sebelum dicatat.
  const metadata = { ...input } as Record<string, unknown>;
  delete metadata.baseSalary;
  delete metadata.bankName;
  delete metadata.bankAccount;
  await recordAudit({
    orgId,
    userId,
    action: "hrm.employee.update",
    entity: "employee",
    entityId: id,
    metadata,
  });
  return row;
}

// ---------------- Shifts / Wifi ----------------

export async function listShifts(orgId: string): Promise<Shift[]> {
  return db
    .select()
    .from(shifts)
    .where(eq(shifts.orgId, orgId))
    .orderBy(shifts.name);
}

export async function createShift(
  userId: string,
  orgId: string,
  input: { name: string; startTime: string; endTime: string },
): Promise<Shift> {
  await requireOrgRole(userId, orgId, "admin");
  const [row] = await db
    .insert(shifts)
    .values({ orgId, ...input })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "hrm.shift.create",
    entity: "shift",
    entityId: row.id,
  });
  return row;
}

export async function listOfficeWifi(orgId: string): Promise<OfficeWifi[]> {
  return db
    .select()
    .from(officeWifi)
    .where(eq(officeWifi.orgId, orgId))
    .orderBy(officeWifi.ssid);
}

export async function createOfficeWifi(
  userId: string,
  orgId: string,
  input: { branchId: string; ssid: string; notes?: string | null },
): Promise<OfficeWifi> {
  await requireOrgRole(userId, orgId, "admin");
  // branch harus milik org yang sama
  const [branch] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, input.branchId), eq(branches.orgId, orgId)))
    .limit(1);
  if (!branch) {
    throw new OrgScopeError("NO_MEMBERSHIP", "Cabang tidak ditemukan.");
  }
  const [row] = await db
    .insert(officeWifi)
    .values({ orgId, ...input })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "hrm.wifi.create",
    entity: "office_wifi",
    entityId: row.id,
  });
  return row;
}

// ---------------- Attendance ----------------

export interface MarkAttendanceInput {
  employeeId: string;
  date: string; // "YYYY-MM-DD"
  checkInAt?: Date | null;
  checkOutAt?: Date | null;
  method?: "gps" | "wifi" | "manual";
  status?: "ontime" | "late" | "absent" | "leave" | "wfh";
  overtimeMinutes?: number;
  notes?: string | null;
}

/** Rentang presensi dibatasi supaya year-wide query tidak menumpuk row. */
const MAX_ATTENDANCE_RANGE_DAYS = 62;
const MAX_ATTENDANCE_ROWS = 5000;

export async function listAttendances(
  orgId: string,
  range: { from: string; to: string; employeeId?: string },
): Promise<Attendance[]> {
  const spanMs =
    new Date(`${range.to}T00:00:00Z`).getTime() -
    new Date(`${range.from}T00:00:00Z`).getTime();
  const spanDays = Math.round(spanMs / 86_400_000) + 1;
  if (!Number.isFinite(spanDays) || spanDays < 1) {
    throw new Error("Rentang tanggal presensi tidak valid.");
  }
  if (spanDays > MAX_ATTENDANCE_RANGE_DAYS) {
    throw new Error(
      `Rentang presensi maksimal ${MAX_ATTENDANCE_RANGE_DAYS} hari.`,
    );
  }
  const conds = [
    eq(attendances.orgId, orgId),
    gte(attendances.date, range.from),
    lte(attendances.date, range.to),
  ];
  if (range.employeeId) {
    conds.push(eq(attendances.employeeId, range.employeeId));
  }
  return db
    .select()
    .from(attendances)
    .where(and(...conds))
    .orderBy(asc(attendances.date), asc(attendances.employeeId))
    .limit(MAX_ATTENDANCE_ROWS);
}

export async function markAttendance(
  userId: string,
  orgId: string,
  input: MarkAttendanceInput,
): Promise<Attendance> {
  await requireOrgRole(userId, orgId, "admin");
  await requireEmployee(orgId, input.employeeId);
  const overtimeMinutes = input.overtimeMinutes ?? 0;
  if (overtimeMinutes < 0 || !Number.isInteger(overtimeMinutes)) {
    throw new OrgScopeError(
      "INSUFFICIENT_ROLE",
      "Overtime minutes harus integer >= 0.",
    );
  }
  const [row] = await db
    .insert(attendances)
    .values({
      orgId,
      employeeId: input.employeeId,
      date: input.date,
      checkInAt: input.checkInAt ?? null,
      checkOutAt: input.checkOutAt ?? null,
      method: input.method ?? "manual",
      status: input.status ?? "ontime",
      overtimeMinutes,
      notes: input.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [attendances.employeeId, attendances.date],
      set: {
        checkInAt: input.checkInAt ?? null,
        checkOutAt: input.checkOutAt ?? null,
        method: input.method ?? "manual",
        status: input.status ?? "ontime",
        overtimeMinutes,
        notes: input.notes ?? null,
      },
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "hrm.attendance.mark",
    entity: "attendance",
    entityId: row.id,
    metadata: { date: input.date, status: row.status, overtimeMinutes },
  });
  return row;
}

// ---------------- Leave ----------------

const LEAVE_BALANCE_FIELD = {
  cuti: "cutiRemaining",
  izin: "izinRemaining",
} as const;

async function ensureBalance(
  orgId: string,
  employeeId: string,
  year: number,
): Promise<LeaveBalance> {
  const [existing] = await db
    .select()
    .from(leaveBalances)
    .where(
      and(
        eq(leaveBalances.employeeId, employeeId),
        eq(leaveBalances.year, year),
        eq(leaveBalances.orgId, orgId),
      ),
    )
    .limit(1);
  if (existing) return existing;
  // Race-safe: dua ensure konkuren — yang kalah baca ulang baris pemenang.
  const [row] = await db
    .insert(leaveBalances)
    .values({ orgId, employeeId, year })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [reread] = await db
    .select()
    .from(leaveBalances)
    .where(
      and(
        eq(leaveBalances.employeeId, employeeId),
        eq(leaveBalances.year, year),
        eq(leaveBalances.orgId, orgId),
      ),
    )
    .limit(1);
  return reread;
}

/** Varian transaksional ensureBalance (dipakai actLeaveApproval). */
async function ensureBalanceTx(
  tx: Tx,
  orgId: string,
  employeeId: string,
  year: number,
): Promise<LeaveBalance> {
  const scope = [
    eq(leaveBalances.employeeId, employeeId),
    eq(leaveBalances.year, year),
    eq(leaveBalances.orgId, orgId),
  ];
  const [existing] = await tx
    .select()
    .from(leaveBalances)
    .where(and(...scope))
    .limit(1);
  if (existing) return existing;
  const [row] = await tx
    .insert(leaveBalances)
    .values({ orgId, employeeId, year })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [reread] = await tx
    .select()
    .from(leaveBalances)
    .where(and(...scope))
    .limit(1);
  return reread;
}

/**
 * Debit saldo atomik bersyarat: predikat `remaining >= days` di dalam satu
 * UPDATE — overdraft melempar (sinyal gagal eksplisit), bukan clamp diam.
 */
async function debitLeaveBalanceTx(
  tx: Tx,
  orgId: string,
  employeeId: string,
  year: number,
  type: "cuti" | "izin",
  days: number,
): Promise<void> {
  const field = LEAVE_BALANCE_FIELD[type];
  const column =
    field === "cutiRemaining"
      ? leaveBalances.cutiRemaining
      : leaveBalances.izinRemaining;
  const scope = [
    eq(leaveBalances.orgId, orgId),
    eq(leaveBalances.employeeId, employeeId),
    eq(leaveBalances.year, year),
  ];
  const [updated] = await tx
    .update(leaveBalances)
    .set(
      field === "cutiRemaining"
        ? { cutiRemaining: sql`${column} - ${days}` }
        : { izinRemaining: sql`${column} - ${days}` },
    )
    .where(and(...scope, gte(column, days)))
    .returning();
  if (updated) return;
  const [existing] = await tx
    .select()
    .from(leaveBalances)
    .where(and(...scope))
    .limit(1);
  const remaining = existing ? existing[field] : 0;
  throw new Error(
    `Sisa ${type} tidak cukup (butuh ${days}, sisa ${remaining}).`,
  );
}

export async function getLeaveBalance(
  orgId: string,
  employeeId: string,
  year: number,
): Promise<LeaveBalance> {
  await requireEmployee(orgId, employeeId);
  return ensureBalance(orgId, employeeId, year);
}

export async function listLeaveRequests(
  orgId: string,
  opts?: { limit?: number },
): Promise<LeaveRequest[]> {
  // Default cap: tanpa ini pemanggil me-render seluruh tabel.
  const limit = Math.min(Math.max(opts?.limit ?? 500, 1), 5000);
  return db
    .select()
    .from(leaveRequests)
    .where(eq(leaveRequests.orgId, orgId))
    .orderBy(desc(leaveRequests.createdAt))
    .limit(limit);
}

/** Hitung hari kalender inklusif start..end (input "YYYY-MM-DD"). */
function daysBetween(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  const diff = Math.round((b - a) / 86_400_000) + 1;
  if (diff <= 0) {
    throw new Error("Rentang tanggal tidak valid.");
  }
  return diff;
}

/**
 * Buat leave request + rantai approval level-1, dipersist via approval store.
 * Balance divalidasi di sini, dipotong saat approval final (actLeaveApproval).
 */
export async function createLeaveRequest(
  userId: string,
  orgId: string,
  input: {
    employeeId: string;
    type: "cuti" | "izin" | "sakit" | "wfh";
    startDate: string;
    endDate: string;
    reason?: string | null;
    attachmentUrl?: string | null;
    approverId: string;
  },
): Promise<{ request: LeaveRequest; approvalRequestId: string }> {
  await requireOrgRole(userId, orgId, "member");
  await requireEmployee(orgId, input.employeeId);
  const days = daysBetween(input.startDate, input.endDate);
  const year = Number(input.startDate.slice(0, 4));
  if (input.type === "cuti" || input.type === "izin") {
    const balance = await ensureBalance(orgId, input.employeeId, year);
    const remaining =
      input.type === "cuti" ? balance.cutiRemaining : balance.izinRemaining;
    if (days > remaining) {
      throw new Error(
        `Sisa ${input.type} tidak cukup (butuh ${days}, sisa ${remaining}).`,
      );
    }
  }
  if (input.approverId === userId) {
    throw new Error("Pemohon tidak boleh menjadi approver.");
  }
  // ID tak-tertebak (bukan Date.now+Math.random): requestId dipakai sebagai
  // korelasi lintas approval store dan leave_requests.
  const requestId = `leave-${crypto.randomUUID()}`;
  const req = createApproval({
    requestId,
    requestedBy: userId,
    chain: [{ approverId: input.approverId }],
  });
  const saved = await saveApprovalRequest(orgId, req);
  const [row] = await db
    .insert(leaveRequests)
    .values({
      orgId,
      employeeId: input.employeeId,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason ?? null,
      attachmentUrl: input.attachmentUrl ?? null,
      approvalId: saved.id,
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "hrm.leave.create",
    entity: "leave_request",
    entityId: row.id,
    metadata: {
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      days,
    },
  });
  return { request: row, approvalRequestId: req.requestId };
}

/**
 * Approve/reject leave request lewat approval engine + store.
 * Balance dipotong sebanyak durasi (hari) saat status jadi approved.
 *
 * Atomik dalam satu transaksi: baris approval dikunci (FOR UPDATE) supaya
 * dua keputusan konkuren terserialisasi — yang kalah melihat status
 * terminal dan engine menolaknya, bukan menimpa diam-diam. Debit saldo
 * bersyarat (`remaining >= days`) sehingga tidak pernah over-grant.
 */
export async function actLeaveApproval(
  actorId: string,
  orgId: string,
  leaveRequestId: string,
  action: "approve" | "reject",
  note?: string,
): Promise<"approved" | "rejected" | "pending"> {
  return db.transaction(async (tx) => {
    const [lr] = await tx
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.id, leaveRequestId),
          eq(leaveRequests.orgId, orgId),
        ),
      )
      .limit(1);
    if (!lr || !lr.approvalId) {
      throw new OrgScopeError(
        "NO_MEMBERSHIP",
        "Leave request tidak ditemukan.",
      );
    }
    const { state: stored } = await getApprovalRequestByRowIdForUpdate(
      tx,
      orgId,
      lr.approvalId,
    );
    const next =
      action === "approve"
        ? approve(stored, actorId, note)
        : reject(stored, actorId, note);
    await saveApprovalRequestTx(tx, orgId, next);
    const cs = currentState(next);
    if (
      cs.status === "approved" &&
      (lr.type === "cuti" || lr.type === "izin")
    ) {
      const year = Number(lr.startDate.slice(0, 4));
      const days = daysBetween(lr.startDate, lr.endDate);
      await ensureBalanceTx(tx, lr.orgId, lr.employeeId, year);
      await debitLeaveBalanceTx(
        tx,
        lr.orgId,
        lr.employeeId,
        year,
        lr.type,
        days,
      );
    }
    await recordAudit(
      {
        orgId,
        userId: actorId,
        action: `hrm.leave.${action}`,
        entity: "leave_request",
        entityId: lr.id,
        metadata: { status: cs.status },
      },
      tx,
    );
    return cs.status;
  });
}

export async function listLeaveBalances(
  orgId: string,
  year: number,
): Promise<LeaveBalance[]> {
  return db
    .select()
    .from(leaveBalances)
    .where(and(eq(leaveBalances.orgId, orgId), eq(leaveBalances.year, year)))
    .orderBy(asc(leaveBalances.employeeId));
}
