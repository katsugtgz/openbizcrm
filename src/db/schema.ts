import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  date,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import type { ApprovalRequest } from "@/lib/approval";
import type { Payslip as PayslipBreakdown } from "@/lib/payroll/engine";

export const roleEnum = pgEnum("role", ["owner", "admin", "member"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const branches = pgTable("branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  address: text("address"),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  workosUserId: text("workos_user_id").unique(),
  email: text("email").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  currentOrgId: uuid("current_org_id").references(() => organizations.id),
});

export const orgMemberships = pgTable(
  "org_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("member"),
  },
  (table) => [
    unique("org_memberships_org_user_unique").on(table.orgId, table.userId),
  ],
);

// ---------------------------------------------------------------------------
// HRM
// ---------------------------------------------------------------------------

export const employeeStatusEnum = pgEnum("employee_status", [
  "active",
  "resigned",
  "suspended",
]);

export const taxStatusEnum = pgEnum("tax_status", [
  "TK0",
  "TK1",
  "TK2",
  "TK3",
  "KI0",
  "KI1",
  "KI2",
  "KI3",
]);

export const attendanceMethodEnum = pgEnum("attendance_method", [
  "gps",
  "wifi",
  "manual",
]);

export const attendanceStatusEnum = pgEnum("attendance_status", [
  "ontime",
  "late",
  "absent",
  "leave",
  "wfh",
]);

export const leaveTypeEnum = pgEnum("leave_type", [
  "cuti",
  "izin",
  "sakit",
  "wfh",
]);

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const positions = pgTable("positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => branches.id, {
    onDelete: "set null",
  }),
  userId: uuid("user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  departmentId: uuid("department_id").references(() => departments.id, {
    onDelete: "set null",
  }),
  positionId: uuid("position_id").references(() => positions.id, {
    onDelete: "set null",
  }),
  employeeNo: text("employee_no").notNull(),
  name: text("name").notNull(),
  status: employeeStatusEnum("status").notNull().default("active"),
  taxStatus: taxStatusEnum("tax_status").notNull().default("TK0"),
  /** Gaji pokok bulanan, rupiah integer (assertSafeAmount). */
  baseSalary: integer("base_salary").notNull(),
  /** Data rekening untuk export transfer bank (opsional). */
  bankName: text("bank_name"),
  bankAccount: text("bank_account"),
  hireDate: date("hire_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const shifts = pgTable("shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** "HH:MM" lokal, mis. "09:00". */
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
});

export const officeWifi = pgTable("office_wifi", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "cascade" }),
  ssid: text("ssid").notNull(),
  notes: text("notes"),
});

export const attendances = pgTable(
  "attendances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    checkInAt: timestamp("check_in_at", { withTimezone: true }),
    checkOutAt: timestamp("check_out_at", { withTimezone: true }),
    method: attendanceMethodEnum("method").notNull().default("manual"),
    status: attendanceStatusEnum("status").notNull().default("ontime"),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("attendances_employee_date_unique").on(table.employeeId, table.date),
  ],
);

export const leaveRequests = pgTable("leave_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  type: leaveTypeEnum("type").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason"),
  attachmentUrl: text("attachment_url"),
  /** approval_requests.id — rantai persetujuan (approval store). */
  // ponytail: FK tanpa .references — integritas dijaga repo layer.
  approvalId: uuid("approval_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    /** Jatah cuti & izin per tahun (hari). */
    cutiRemaining: integer("cuti_remaining").notNull().default(12),
    izinRemaining: integer("izin_remaining").notNull().default(12),
  },
  (table) => [
    unique("leave_balances_employee_year_unique").on(
      table.employeeId,
      table.year,
    ),
  ],
);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: text("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: text("request_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    state: jsonb("state").$type<ApprovalRequest>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // Request IDs are unique per organization, not globally: the org must
  // participate in the conflict invariant (cubic P1 store finding).
  (t) => [
    unique("approval_requests_org_request_unique").on(
      t.organizationId,
      t.requestId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Penggajian (payroll)
// ---------------------------------------------------------------------------

export const payrollRunStatusEnum = pgEnum("payroll_run_status", [
  "draft",
  "final",
]);

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    status: payrollRunStatusEnum("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("payroll_runs_org_period_unique").on(
      table.orgId,
      table.year,
      table.month,
    ),
  ],
);

export const payslips = pgTable(
  "payslips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** Hasil computePayslip (engine.ts) — bruto, potongan, net, breakdown. */
    breakdown: jsonb("breakdown").$type<PayslipBreakdown>().notNull(),
    /** Redundansi kueri cepat; sumber kebenaran tetap breakdown.net. */
    netAmount: integer("net_amount").notNull(),
  },
  (table) => [
    unique("payslips_run_employee_unique").on(table.runId, table.employeeId),
  ],
);

export type PayrollRun = typeof payrollRuns.$inferSelect;
export type Payslip = typeof payslips.$inferSelect;
