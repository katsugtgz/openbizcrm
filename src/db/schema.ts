import {
  pgTable,
  pgEnum,
  uuid,
  bigint,
  text,
  timestamp,
  integer,
  date,
  jsonb,
  unique,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { ApprovalRequest } from "@/lib/approval";
import type { Payslip as PayslipBreakdown } from "@/lib/payroll/engine";

export const roleEnum = pgEnum("role", ["owner", "admin", "member"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  // WorkOS "org_…" id — the auth boundary maps AuthKit session organizationId
  // to the internal row (src/lib/auth/ids.ts). Nullable: fake/dev orgs have
  // no WorkOS counterpart.
  workosOrgId: text("workos_org_id").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
  },
  // Branch names are unique per organization — seed's idempotency check reads
  // this constraint instead of racing a select-then-insert (cubic P2 seed:33).
  // The (org_id, name) unique index also backs org-scoped branch lists
  // (filter org_id, order name — cubic P2 0000:13); no separate index needed.
  (t) => [unique("branches_org_name_unique").on(t.orgId, t.name)],
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  workosUserId: text("workos_user_id").unique(),
  // Email resolves identity (getUserByEmail); duplicates would let an
  // arbitrary account be picked (cubic P2 user-repo:27).
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  // SET NULL: deleting an org clears stale current-org selections instead of
  // rejecting the delete (cubic P2 0000:51).
  currentOrgId: uuid("current_org_id").references(() => organizations.id, {
    onDelete: "set null",
  }),
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

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  // Org-scoped history filters org_id and sorts created_at (cubic P2 0000:2).
  (t) => [index("audit_logs_org_created_idx").on(t.orgId, t.createdAt)],
);

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

// ---------------------------------------------------------------------------
// Proyek / Task / Timesheet
// ---------------------------------------------------------------------------

export const projectStatusEnum = pgEnum("project_status", [
  "planning",
  "active",
  "on_hold",
  "done",
  "cancelled",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "todo",
  "in_progress",
  "review",
  "done",
  "blocked",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // FK real: crm_companies sudah ada di schema (modul CRM).
    clientCompanyId: uuid("client_company_id").references(
      () => crmCompanies.id,
      { onDelete: "set null" },
    ),
    name: text("name").notNull(),
    /** Auto-gen "PRJ-001" per org (project-repo.createProject). */
    code: text("code").notNull(),
    status: projectStatusEnum("status").notNull().default("planning"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  // Backstop race auto-gen code; juga mempercepat filter org+code.
  (t) => [unique("projects_org_code_unique").on(t.orgId, t.code)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("todo"),
    priority: taskPriorityEnum("priority").notNull().default("medium"),
    assigneeId: uuid("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Urutan kanban dalam kolom status; renumber saat reorder. */
    position: integer("position").notNull().default(0),
    dueDate: date("due_date"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  // Kanban: fetch kolom per proyek terurut posisi (cubic P2 0000:2).
  (t) => [
    index("tasks_project_status_pos_idx").on(t.projectId, t.status, t.position),
    // Daily generation idempotency: satu judul task per proyek per hari —
    // generateTodayAction check-and-create jadi atomic di level DB
    // (cubic P2 proyek-actions:279). dueDate NULL (task non-harian) bebas.
    unique("tasks_org_project_title_due_unique").on(
      t.orgId,
      t.projectId,
      t.title,
      t.dueDate,
    ),
  ],
);

export const taskTemplates = pgTable("task_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  priority: taskPriorityEnum("priority").notNull().default("medium"),
});

export const timesheets = pgTable(
  "timesheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Menit (bulat) saat stop; null selama timer terbuka. */
    minutes: integer("minutes"),
    notes: text("notes"),
  },
  (t) => [
    // Satu timer terbuka per user — backstop DB untuk cek service (race).
    uniqueIndex("timesheets_open_timer_unique")
      .on(t.userId)
      .where(sql`ended_at IS NULL`),
    index("timesheets_org_task_idx").on(t.orgId, t.taskId),
  ],
);

export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskTemplate = typeof taskTemplates.$inferSelect;
export type Timesheet = typeof timesheets.$inferSelect;

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

export const crmDealStatusEnum = pgEnum("crm_deal_status", [
  "open",
  "won",
  "lost",
]);

export const crmQuotationStatusEnum = pgEnum("crm_quotation_status", [
  "draft",
  "sent",
  "accepted",
  "rejected",
]);

export const crmActivityTypeEnum = pgEnum("crm_activity_type", [
  "call",
  "task",
  "meeting",
  "note",
]);

export const crmCompanies = pgTable(
  "crm_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    industry: text("industry"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  // Org-scoped company lists filter org_id + order name (cubic P2 0000:13).
  (t) => [
    // unique (org, name) sudah memenuhi filter/order org+name — index polos
    // duplikat hanya menambah biaya tulis (cubic P3 schema:525).
    unique("crm_companies_org_name_unique").on(t.orgId, t.name),
  ],
);

export const crmContacts = pgTable(
  "crm_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => crmCompanies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    position: text("position"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("crm_contacts_org_company_idx").on(t.orgId, t.companyId)],
);

export const crmPipelines = pgTable(
  "crm_pipelines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => crmCompanies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("crm_pipelines_org_company_name_unique").on(
      t.orgId,
      t.companyId,
      t.name,
    ),
  ],
);

export const crmStages = pgTable(
  "crm_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => crmPipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Urutan tampil kanban; 0 pertama. */
    position: integer("position").notNull(),
  },
  (t) => [
    unique("crm_stages_pipeline_position_unique").on(t.pipelineId, t.position),
  ],
);

export const crmDeals = pgTable(
  "crm_deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => crmPipelines.id, { onDelete: "cascade" }),
    // restrict: deal = catatan penjualan, stage berisi deal tidak boleh
    // terhapus diam-diam (cubic P2 schema:604).
    stageId: uuid("stage_id")
      .notNull()
      .references(() => crmStages.id, { onDelete: "restrict" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => crmCompanies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => crmContacts.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    /** Nilai deal, rupiah integer (assertSafeAmount). */
    // bigint mode number: assertSafeAmount mengizinkan sampai
    // MAX_SAFE_INTEGER, int4 rembes di > 2,1 miliar (cubic P2 schema:613).
    value: bigint("value", { mode: "number" }).notNull().default(0),
    status: crmDealStatusEnum("status").notNull().default("open"),
    quotationStatus: crmQuotationStatusEnum("quotation_status")
      .notNull()
      .default("draft"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  // Kanban board: ambil deals per org + pipeline, urut stage.
  (t) => [index("crm_deals_org_pipeline_idx").on(t.orgId, t.pipelineId)],
);

export const crmActivities = pgTable(
  "crm_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => crmDeals.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    type: crmActivityTypeEnum("type").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  // Timeline deal: filter deal_id, sort created_at desc.
  (t) => [index("crm_activities_deal_created_idx").on(t.dealId, t.createdAt)],
);

export type CrmCompany = typeof crmCompanies.$inferSelect;
export type CrmContact = typeof crmContacts.$inferSelect;
export type CrmPipeline = typeof crmPipelines.$inferSelect;
export type CrmStage = typeof crmStages.$inferSelect;
export type CrmDeal = typeof crmDeals.$inferSelect;
export type CrmActivity = typeof crmActivities.$inferSelect;
