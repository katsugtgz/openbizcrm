import {
  check,
  foreignKey,
  pgTable,
  pgEnum,
  uuid,
  bigint,
  boolean,
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

/** tasks.source: dibuat manual atau digenerate harian dari template. */
export const taskSourceEnum = pgEnum("task_source", ["manual", "daily"]);

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
  // User-only provisioning marker (cubic P1 ids:128): true when the user row
  // was provisioned from a session WITHOUT a WorkOS org id, so a later
  // session that carries one retries org provisioning instead of being
  // permanently gated by the missing membership.
  needsOrg: boolean("needs_org").default(false).notNull(),
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
    // Discriminator idempotensi harian: 'daily' task digenerate template,
    // 'manual' dibuat user — hanya 'daily' yang masuk unique partial index
    // (cubic P2 0010:1).
    source: taskSourceEnum("source").notNull().default("manual"),
    /** Tanggal generate (WIB) untuk task source='daily'; null untuk manual. */
    dailyForDate: date("daily_for_date"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  // Kanban: fetch kolom per proyek terurut posisi (cubic P2 0000:2).
  (t) => [
    index("tasks_project_status_pos_idx").on(t.projectId, t.status, t.position),
    // Daily generation idempotency: satu judul per proyek per hari — hanya
    // baris source='daily' (cubic P2 0010:1). Partial unique index manual:
    // Drizzle tak punya `.where()` untuk `unique()` constraint table-level.
    uniqueIndex("tasks_org_project_daily_title_unique")
      .on(t.orgId, t.projectId, t.dailyForDate, t.title)
      .where(sql`source = 'daily'`),
    // cubic schema.ts:449 — PostgreSQL menganggap NULL berbeda-beda di unique
    // index, jadi daily tanpa tanggal bisa lolos idempotensi. Backstop CHECK:
    // setiap task harian wajib punya daily_for_date.
    check(
      "tasks_daily_date_required",
      sql`source <> 'daily' OR daily_for_date IS NOT NULL`,
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

// ---------------------------------------------------------------------------
// Akuntansi (double-entry)
// ---------------------------------------------------------------------------

export const accountTypeEnum = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);

export const journalStatusEnum = pgEnum("journal_status", ["draft", "posted"]);

export const journalSourceEnum = pgEnum("journal_source", [
  "manual",
  "invoice",
  "payment",
  "pos",
  "payroll",
  "depreciation",
]);

/** Sumber dana kas (pos transaksi tunai / transfer / QRIS). */
export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "transfer",
  "qris",
]);

export const inventoryReasonEnum = pgEnum("inventory_reason", [
  "sale",
  "restock",
  "adjust",
]);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull(),
    /** Parent account (chart of accounts bersarang); null = root. */
    parentId: uuid("parent_id").references((): AnyPgColumn => accounts.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // Kode akun unik per org — chart of accounts rapi, filter org+code cepat.
    unique("accounts_org_code_unique").on(t.orgId, t.code),
    // Parent key utk FK komposit tenant-aware dari journal_lines (cubic pr8
    // schema:813): akun tidak bisa dikaitkan lintas org.
    unique("accounts_org_id_unique").on(t.orgId, t.id),
  ],
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references((): AnyPgColumn => products.id, { onDelete: "restrict" }),
    /** Saldo berubah +qty (restock) / -qty (sale). */
    qtyDelta: integer("qty_delta").notNull(),
    reason: inventoryReasonEnum("reason").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // Kartu stok per produk, urut waktu.
    index("inventory_movements_org_product_idx").on(
      t.orgId,
      t.productId,
      t.createdAt,
    ),
  ],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Nomor jurnal berurutan per org (max+1 in-tx, service.ts). */
    entryNumber: integer("entry_number").notNull(),
    date: date("date").notNull(),
    description: text("description"),
    status: journalStatusEnum("status").notNull().default("draft"),
    source: journalSourceEnum("source").notNull().default("manual"),
    /** Metode bayar untuk jurnal kas (null kalau bukan transaksi kas). */
    paymentMethod: paymentMethodEnum("payment_method"),
    /** Closing adjustment: ini jurnal pos closing yang menjaga rentang per periode */
    isClosingEntry: boolean("is_closing_entry").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("journal_entries_org_number_unique").on(t.orgId, t.entryNumber),
    // Parent key utk FK komposit tenant-aware (cubic pr8 schema:902).
    unique("journal_entries_org_id_unique").on(t.orgId, t.id),
    index("journal_entries_org_date_idx").on(t.orgId, t.date),
  ],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references((): AnyPgColumn => journalEntries.id, {
        onDelete: "cascade",
      }),
    accountId: uuid("account_id")
      .notNull()
      .references((): AnyPgColumn => accounts.id, { onDelete: "restrict" }),
    /** Rupiah integer >= 0 (assertSafeAmount); salah satu dari keduanya 0. */
    debit: bigint("debit", { mode: "number" }).notNull().default(0),
    credit: bigint("credit", { mode: "number" }).notNull().default(0),
    description: text("description"),
  },
  (t) => [
    index("journal_lines_org_account_idx").on(t.orgId, t.accountId),
    // FK komposit tenant-aware (cubic pr8 schema:813): entry & akun wajib
    // milik org yang sama dengan barisnya — cross-org tertolak di DB.
    foreignKey({
      name: "journal_lines_entry_org_fk",
      columns: [t.orgId, t.entryId],
      foreignColumns: [journalEntries.orgId, journalEntries.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "journal_lines_account_org_fk",
      columns: [t.orgId, t.accountId],
      foreignColumns: [accounts.orgId, accounts.id],
    }).onDelete("restrict"),
    // Tepat satu sisi positif (cubic pr8 schema:826) — (0,0) tak valid; batas
    // per baris = batas engine JS aman (MAX_LINE_AMOUNT), supaya setiap penulis
    // jurnal (invoice/POS/depresiasi) memakai constraint DB yang sama.
    check(
      "journal_lines_amounts_check",
      sql`debit >= 0 AND credit >= 0 AND debit <= 9007199254740991 AND credit <= 9007199254740991 AND (debit > 0 AND credit = 0 OR credit > 0 AND debit = 0)`,
    ),
  ],
);

export type Account = typeof accounts.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type JournalLine = typeof journalLines.$inferSelect;
export type InventoryMovement = typeof inventoryMovements.$inferSelect;

/** Periode fiskal per org (kalender bulan): closed = tidak bisa posting. */
export const fiscalPeriods = pgTable(
  "fiscal_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    closed: boolean("closed").notNull().default(false),
    closedBy: uuid("closed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique("fiscal_periods_org_start_unique").on(t.orgId, t.periodStart)],
);

export type FiscalPeriod = typeof fiscalPeriods.$inferSelect;

// ---------------------------------------------------------------------------
// Produk / POS
// ---------------------------------------------------------------------------

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** SKU unik per org. */
    sku: text("sku").notNull(),
    /** Harga jual, rupiah integer (assertSafeAmount). */
    price: bigint("price", { mode: "number" }).notNull(),
    /** Saldo stok; kartu mutasinya inventory_movements. */
    stockQty: integer("stock_qty").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("products_org_sku_unique").on(t.orgId, t.sku),
    check("products_stock_nonnegative", sql`stock_qty >= 0`),
  ],
);

/** Penjualan POS: header satu transaksi kasir. */
export const posSales = pgTable(
  "pos_sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Nomor struk per org, "SLS-001" (pola project-code). */
    saleNumber: text("sale_number").notNull(),
    /** Item POS dipakai: produk dipakai user, tidak di-link dokumen. */
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    /** Tax 0..100 persen; default 0 (POS kecil tanpa PPN). */
    taxPct: integer("tax_pct").notNull().default(0),
    subtotal: bigint("subtotal", { mode: "number" }).notNull(),
    taxAmount: bigint("tax_amount", { mode: "number" }).notNull(),
    total: bigint("total", { mode: "number" }).notNull(),
    // FK tenant-aware: jurnal harus milik org yang sama (cubic pr8 :902).
    journalEntryId: uuid("journal_entry_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("pos_sales_org_number_unique").on(t.orgId, t.saleNumber),
    // FK komposit journalEntryId -> jurnal org yang sama (cubic pr8 :902).
    unique("pos_sales_org_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "pos_sales_journal_entry_org_fk",
      columns: [t.orgId, t.journalEntryId],
      foreignColumns: [journalEntries.orgId, journalEntries.id],
    }),
    index("pos_sales_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

export const posSaleItems = pgTable(
  "pos_sale_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => posSales.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    productName: text("product_name").notNull(),
    qty: integer("qty").notNull(),
    unitPrice: bigint("unit_price", { mode: "number" }).notNull(),
    lineTotal: bigint("line_total", { mode: "number" }).notNull(),
  },
  (t) => [index("pos_sale_items_sale_idx").on(t.saleId)],
);

export type Product = typeof products.$inferSelect;
export type PosSale = typeof posSales.$inferSelect;
export type PosSaleItem = typeof posSaleItems.$inferSelect;

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "sent",
  "paid",
  "overdue",
  "cancelled",
]);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** "INV-001" per org (pola project-code, advisory lock). */
    invoiceNumber: text("invoice_number").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => crmCompanies.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id").references(() => crmContacts.id, {
      onDelete: "set null",
    }),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    taxPct: integer("tax_pct").notNull().default(0),
    subtotal: bigint("subtotal", { mode: "number" }).notNull(),
    taxAmount: bigint("tax_amount", { mode: "number" }).notNull(),
    total: bigint("total", { mode: "number" }).notNull(),
    /** Akumulasi dibayar; overpayment dicek service (recordPayment). */
    paidAmount: bigint("paid_amount", { mode: "number" }).notNull().default(0),
    journalEntryId: uuid("journal_entry_id"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("invoices_org_number_unique").on(t.orgId, t.invoiceNumber),
    // FK komposit journalEntryId -> jurnal org yang sama (cubic pr8 :902).
    unique("invoices_org_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "invoices_journal_entry_org_fk",
      columns: [t.orgId, t.journalEntryId],
      foreignColumns: [journalEntries.orgId, journalEntries.id],
    }),
    index("invoices_org_status_idx").on(t.orgId, t.status),
  ],
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    qty: integer("qty").notNull(),
    unitPrice: bigint("unit_price", { mode: "number" }).notNull(),
    lineTotal: bigint("line_total", { mode: "number" }).notNull(),
  },
  (t) => [index("invoice_items_invoice_idx").on(t.invoiceId)],
);

/** Pembayaran invoice: satu baris = satu kas masuk + jurnal AR. */
export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    amount: bigint("amount", { mode: "number" }).notNull(),
    method: paymentMethodEnum("method").notNull(),
    paidAt: date("paid_at").notNull(),
    // FK tenant-aware: jurnal harus milik org yang sama (cubic pr8 :902).
    journalEntryId: uuid("journal_entry_id"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // FK komposit journalEntryId -> jurnal org yang sama (cubic pr8 :902).
    foreignKey({
      name: "invoice_payments_journal_entry_org_fk",
      columns: [t.orgId, t.journalEntryId],
      foreignColumns: [journalEntries.orgId, journalEntries.id],
    }),
    index("invoice_payments_invoice_idx").on(t.invoiceId),
  ],
);

export type Invoice = typeof invoices.$inferSelect;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type InvoicePayment = typeof invoicePayments.$inferSelect;

// ---------------------------------------------------------------------------
// Anggaran (budget)
// ---------------------------------------------------------------------------

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** "YYYY-MM" — bulan anggaran (kalender, WIB-neutral). */
    period: text("period").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("budgets_org_account_period_unique").on(
      t.orgId,
      t.accountId,
      t.period,
    ),
    check("budgets_period_format", sql`period ~ '^[0-9]{4}-[0-9]{2}$'`),
  ],
);

export type Budget = typeof budgets.$inferSelect;

// ---------------------------------------------------------------------------
// Aset tetap (fixed assets)
// ---------------------------------------------------------------------------

export const assetStatusEnum = pgEnum("asset_status", ["active", "disposed"]);

export const fixedAssets = pgTable(
  "fixed_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    cost: bigint("cost", { mode: "number" }).notNull(),
    salvageValue: bigint("salvage_value", { mode: "number" })
      .notNull()
      .default(0),
    usefulLifeMonths: integer("useful_life_months").notNull(),
    acquiredDate: date("acquired_date").notNull(),
    /** Akumulasi penyusutan terbukui (redundansi; sumber: jurnal dep). */
    totalDepreciated: bigint("total_depreciated", { mode: "number" })
      .notNull()
      .default(0),
    status: assetStatusEnum("status").notNull().default("active"),
    disposalDate: date("disposal_date"),
    /** Idempotensi per bulan: period terakhir yang sudah didepresiasikan. */
    lastDepreciatedPeriod: text("last_depreciated_period"),
    depreciationExpenseAccountId: uuid("depreciation_expense_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    accumulatedDepreciationAccountId: uuid(
      "accumulated_depreciation_account_id",
    )
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("fixed_assets_org_status_idx").on(t.orgId, t.status),
    check(
      "fixed_assets_depreciable_check",
      sql`salvage_value <= cost AND useful_life_months >= 1`,
    ),
  ],
);

export type FixedAsset = typeof fixedAssets.$inferSelect;
