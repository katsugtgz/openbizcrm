import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  attendances,
  branches,
  departments,
  employees,
  leaveBalances,
  leaveRequests,
  officeWifi,
  positions,
  shifts,
} from "@/db/schema";
import { OrgScopeError, requireOrgRole } from "@/lib/org-scope";
import { assertSafeAmount } from "@/lib/money";
import { recordAudit } from "@/lib/repos/audit-repo";
import { approve, createApproval, currentState, reject } from "@/lib/approval";
import {
  saveApprovalRequest,
  getApprovalRequestByRowId,
} from "@/lib/approval/store";

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
}

export async function listEmployees(orgId: string): Promise<Employee[]> {
  return db
    .select()
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

export async function createEmployee(
  userId: string,
  orgId: string,
  input: EmployeeInput,
): Promise<Employee> {
  await requireOrgRole(userId, orgId, "admin");
  assertSafeAmount(input.baseSalary, "Gaji pokok");
  const [row] = await db
    .insert(employees)
    .values({
      orgId,
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
  await recordAudit({
    orgId,
    userId,
    action: "hrm.employee.create",
    entity: "employee",
    entityId: row.id,
    metadata: { employeeNo: row.employeeNo, baseSalary: row.baseSalary },
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
  const [row] = await db
    .update(employees)
    .set(input)
    .where(and(eq(employees.id, id), eq(employees.orgId, orgId)))
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "hrm.employee.update",
    entity: "employee",
    entityId: id,
    metadata: input as Record<string, unknown>,
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

export async function listAttendances(
  orgId: string,
  range: { from: string; to: string; employeeId?: string },
): Promise<Attendance[]> {
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
    .orderBy(asc(attendances.date), asc(attendances.employeeId));
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
  const [row] = await db
    .insert(leaveBalances)
    .values({ orgId, employeeId, year })
    .returning();
  return row;
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
): Promise<LeaveRequest[]> {
  return db
    .select()
    .from(leaveRequests)
    .where(eq(leaveRequests.orgId, orgId))
    .orderBy(desc(leaveRequests.createdAt));
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
  const requestId = `leave-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
 */
export async function actLeaveApproval(
  actorId: string,
  orgId: string,
  leaveRequestId: string,
  action: "approve" | "reject",
  note?: string,
): Promise<"approved" | "rejected" | "pending"> {
  const [lr] = await db
    .select()
    .from(leaveRequests)
    .where(
      and(eq(leaveRequests.id, leaveRequestId), eq(leaveRequests.orgId, orgId)),
    )
    .limit(1);
  if (!lr || !lr.approvalId) {
    throw new OrgScopeError("NO_MEMBERSHIP", "Leave request tidak ditemukan.");
  }
  const stored = await getApprovalRequestByRowId(orgId, lr.approvalId);
  if (!stored) {
    throw new OrgScopeError(
      "NO_MEMBERSHIP",
      "Approval request tidak ditemukan.",
    );
  }
  const next =
    action === "approve"
      ? approve(stored, actorId, note)
      : reject(stored, actorId, note);
  await saveApprovalRequest(orgId, next);
  const cs = currentState(next);
  if (cs.status === "approved" && (lr.type === "cuti" || lr.type === "izin")) {
    const year = Number(lr.startDate.slice(0, 4));
    const balance = await ensureBalance(lr.orgId, lr.employeeId, year);
    const days = daysBetween(lr.startDate, lr.endDate);
    const field = LEAVE_BALANCE_FIELD[lr.type];
    await db
      .update(leaveBalances)
      .set({ [field]: Math.max(0, balance[field] - days) })
      .where(eq(leaveBalances.id, balance.id));
  }
  await recordAudit({
    orgId,
    userId: actorId,
    action: `hrm.leave.${action}`,
    entity: "leave_request",
    entityId: lr.id,
    metadata: { status: cs.status },
  });
  return cs.status;
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
