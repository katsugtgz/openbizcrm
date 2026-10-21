-- bughunt data-tenant 0029: tenant hardening.
-- Composite (id, org_id) FKs replace single-column FKs (cross-org grafts now
-- rejected at the DB); money/percent/qty CHECKs; per-org employee_no; contact
-- email + company name case-insensitive dedupe; int4 -> bigint salary/net;
-- audit org NOT NULL; deal owner + chat/ai tenant bindings. NOTE: statement
-- order below is hand-fixed (parent UNIQUEs before referencing FKs — the
-- 0025-class PG 42830 trap) and data backfills added; see git history.
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_parent_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "attendances" DROP CONSTRAINT "attendances_employee_id_employees_id_fk";
--> statement-breakpoint
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "crm_activities" DROP CONSTRAINT "crm_activities_deal_id_crm_deals_id_fk";
--> statement-breakpoint
ALTER TABLE "crm_contacts" DROP CONSTRAINT "crm_contacts_company_id_crm_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "crm_deals" DROP CONSTRAINT "crm_deals_pipeline_id_crm_pipelines_id_fk";
--> statement-breakpoint
ALTER TABLE "crm_deals" DROP CONSTRAINT "crm_deals_stage_id_crm_stages_id_fk";
--> statement-breakpoint
ALTER TABLE "crm_deals" DROP CONSTRAINT "crm_deals_company_id_crm_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "crm_deals" DROP CONSTRAINT "crm_deals_contact_id_crm_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "crm_pipelines" DROP CONSTRAINT "crm_pipelines_company_id_crm_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "crm_stages" DROP CONSTRAINT "crm_stages_pipeline_id_crm_pipelines_id_fk";
--> statement-breakpoint
ALTER TABLE "drive_folders" DROP CONSTRAINT "drive_folders_parent_id_drive_folders_id_fk";
--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT "employees_branch_id_branches_id_fk";
--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT "employees_department_id_departments_id_fk";
--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT "employees_position_id_positions_id_fk";
--> statement-breakpoint
ALTER TABLE "fixed_assets" DROP CONSTRAINT "fixed_assets_depreciation_expense_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "fixed_assets" DROP CONSTRAINT "fixed_assets_accumulated_depreciation_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_items" DROP CONSTRAINT "invoice_items_invoice_id_invoices_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_payments" DROP CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk";
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_company_id_crm_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_contact_id_crm_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "leave_balances" DROP CONSTRAINT "leave_balances_employee_id_employees_id_fk";
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_employee_id_employees_id_fk";
--> statement-breakpoint
ALTER TABLE "office_wifi" DROP CONSTRAINT "office_wifi_branch_id_branches_id_fk";
--> statement-breakpoint
ALTER TABLE "payslips" DROP CONSTRAINT "payslips_run_id_payroll_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "payslips" DROP CONSTRAINT "payslips_employee_id_employees_id_fk";
--> statement-breakpoint
ALTER TABLE "pos_sale_items" DROP CONSTRAINT "pos_sale_items_sale_id_pos_sales_id_fk";
--> statement-breakpoint
ALTER TABLE "pos_sale_items" DROP CONSTRAINT "pos_sale_items_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_client_company_id_crm_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_parent_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "timesheets" DROP CONSTRAINT "timesheets_task_id_tasks_id_fk";
--> statement-breakpoint
-- Org-less audit rows are unattributable (no writer produces them);
-- drop them before the NOT NULL constraint.
DELETE FROM "audit_logs" WHERE "org_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "org_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "base_salary" SET DATA TYPE bigint;
--> statement-breakpoint
ALTER TABLE "payslips" ALTER COLUMN "net_amount" SET DATA TYPE bigint;
--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "org_id" uuid;
--> statement-breakpoint
ALTER TABLE "chat_conversation_members" ADD COLUMN "org_id" uuid;
--> statement-breakpoint
ALTER TABLE "crm_deals" ADD COLUMN "owner_user_id" uuid;
--> statement-breakpoint
-- Backfill tenant bindings added as nullable columns (existing writers
-- predate them); NULL rows keep passing the composite FKs (MATCH SIMPLE).
UPDATE "ai_messages" AS m SET "org_id" = c."org_id" FROM "ai_conversations" AS c WHERE m."conversation_id" = c."id" AND m."org_id" IS NULL;
--> statement-breakpoint
UPDATE "chat_conversation_members" AS m SET "org_id" = c."org_id" FROM "chat_conversations" AS c WHERE m."conversation_id" = c."id" AND m."org_id" IS NULL AND EXISTS (SELECT 1 FROM "org_memberships" AS om WHERE om."org_id" = c."org_id" AND om."user_id" = m."user_id");
--> statement-breakpoint
-- cubic pr10 0029:94: fail with remediation (not midway) when tenants
-- already violate the new uniqueness rules.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "crm_companies" GROUP BY "org_id", lower("name") HAVING count(*) > 1 LIMIT 1) THEN RAISE EXCEPTION 'bughunt 0029: duplicate company names in one org — rename or merge them first (SELECT org_id, lower(name), count(*) FROM crm_companies GROUP BY 1, 2 HAVING count(*) > 1)'; END IF; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_companies_org_lower_name_unique" ON "crm_companies" USING btree ("org_id",lower("name"));
--> statement-breakpoint
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "crm_contacts" WHERE email IS NOT NULL GROUP BY "org_id", lower("email") HAVING count(*) > 1 LIMIT 1) THEN RAISE EXCEPTION 'bughunt 0029: duplicate contact emails in one org — dedupe them first (SELECT org_id, lower(email), count(*) FROM crm_contacts WHERE email IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1)'; END IF; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_contacts_org_lower_email_unique" ON "crm_contacts" USING btree ("org_id",lower("email")) WHERE email IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_id_org_key" UNIQUE("id","org_id");
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_id_org_key" UNIQUE("id","org_id");
--> statement-breakpoint
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_id_org_key" UNIQUE("id","org_id");
--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_id_org_key" UNIQUE("id","org_id");
--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_id_org_key" UNIQUE("id","org_id");
--> statement-breakpoint
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_id_org_key" UNIQUE("id","org_id");
--> statement-breakpoint
ALTER TABLE "crm_stages" ADD CONSTRAINT "crm_stages_id_org_key" UNIQUE("id","org_id");
--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_id_org_key" UNIQUE("id","org_id");
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_id_org_key" UNIQUE("id","org_id");
--> statement-breakpoint
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "employees" GROUP BY "org_id", "employee_no" HAVING count(*) > 1 LIMIT 1) THEN RAISE EXCEPTION 'bughunt 0029: duplicate employee_no in one org — renumber them first (SELECT org_id, employee_no, count(*) FROM employees GROUP BY 1, 2 HAVING count(*) > 1)'; END IF; END $$;
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_no_unique" UNIQUE("org_id","employee_no");
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_id_org_key" UNIQUE("id","org_id");
--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_id_org_key" UNIQUE("id","org_id");
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_id_org_key" UNIQUE("id","org_id");
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_id_org_key" UNIQUE("id","org_id");
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_id_org_key" UNIQUE("id","org_id");
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_org_fk" FOREIGN KEY ("org_id","parent_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_org_fk" FOREIGN KEY ("conversation_id","org_id") REFERENCES "public"."ai_conversations"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_employee_org_fk" FOREIGN KEY ("employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_account_org_fk" FOREIGN KEY ("org_id","account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_conversation_members" ADD CONSTRAINT "chat_conv_members_conversation_org_fk" FOREIGN KEY ("conversation_id","org_id") REFERENCES "public"."chat_conversations"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_conversation_members" ADD CONSTRAINT "chat_conv_members_member_org_fk" FOREIGN KEY ("org_id","user_id") REFERENCES "public"."org_memberships"("org_id","user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_deal_org_fk" FOREIGN KEY ("deal_id","org_id") REFERENCES "public"."crm_deals"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_company_org_fk" FOREIGN KEY ("company_id","org_id") REFERENCES "public"."crm_companies"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_pipeline_org_fk" FOREIGN KEY ("pipeline_id","org_id") REFERENCES "public"."crm_pipelines"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_stage_org_fk" FOREIGN KEY ("stage_id","org_id") REFERENCES "public"."crm_stages"("id","org_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_company_org_fk" FOREIGN KEY ("company_id","org_id") REFERENCES "public"."crm_companies"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_contact_org_fk" FOREIGN KEY ("contact_id","org_id") REFERENCES "public"."crm_contacts"("id","org_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_company_org_fk" FOREIGN KEY ("company_id","org_id") REFERENCES "public"."crm_companies"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_stages" ADD CONSTRAINT "crm_stages_pipeline_org_fk" FOREIGN KEY ("pipeline_id","org_id") REFERENCES "public"."crm_pipelines"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "drive_folders" ADD CONSTRAINT "drive_folders_parent_org_fk" FOREIGN KEY ("parent_id","org_id") REFERENCES "public"."drive_folders"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_org_fk" FOREIGN KEY ("branch_id","org_id") REFERENCES "public"."branches"("id","org_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_org_fk" FOREIGN KEY ("department_id","org_id") REFERENCES "public"."departments"("id","org_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_org_fk" FOREIGN KEY ("position_id","org_id") REFERENCES "public"."positions"("id","org_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_expense_account_org_fk" FOREIGN KEY ("org_id","depreciation_expense_account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_accum_account_org_fk" FOREIGN KEY ("org_id","accumulated_depreciation_account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_org_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_org_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_org_fk" FOREIGN KEY ("company_id","org_id") REFERENCES "public"."crm_companies"("id","org_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contact_org_fk" FOREIGN KEY ("contact_id","org_id") REFERENCES "public"."crm_contacts"("id","org_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_org_fk" FOREIGN KEY ("employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_org_fk" FOREIGN KEY ("employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "office_wifi" ADD CONSTRAINT "office_wifi_branch_org_fk" FOREIGN KEY ("branch_id","org_id") REFERENCES "public"."branches"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_org_fk" FOREIGN KEY ("run_id","org_id") REFERENCES "public"."payroll_runs"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_org_fk" FOREIGN KEY ("employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_sale_items" ADD CONSTRAINT "pos_sale_items_sale_org_fk" FOREIGN KEY ("org_id","sale_id") REFERENCES "public"."pos_sales"("org_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_sale_items" ADD CONSTRAINT "pos_sale_items_product_org_fk" FOREIGN KEY ("product_id","org_id") REFERENCES "public"."products"("id","org_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_org_fk" FOREIGN KEY ("client_company_id","org_id") REFERENCES "public"."crm_companies"("id","org_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_org_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_org_fk" FOREIGN KEY ("parent_id","org_id") REFERENCES "public"."tasks"("id","org_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_task_org_fk" FOREIGN KEY ("task_id","org_id") REFERENCES "public"."tasks"("id","org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_amount_check" CHECK (amount >= 0);
--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_value_check" CHECK (value >= 0);
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_base_salary_check" CHECK (base_salary >= 0);
--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_amounts_check" CHECK (cost >= 0 AND salvage_value >= 0 AND total_depreciated >= 0);
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_qty_check" CHECK (qty >= 1);
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_amounts_check" CHECK (unit_price >= 0 AND line_total >= 0);
--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_amount_check" CHECK (amount >= 0);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tax_pct_check" CHECK (tax_pct >= 0 AND tax_pct <= 100);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_check" CHECK (subtotal >= 0 AND tax_amount >= 0 AND total >= 0 AND paid_amount >= 0);
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_dates_check" CHECK (end_date >= start_date);
--> statement-breakpoint
ALTER TABLE "pos_sale_items" ADD CONSTRAINT "pos_sale_items_qty_check" CHECK (qty >= 1);
--> statement-breakpoint
ALTER TABLE "pos_sale_items" ADD CONSTRAINT "pos_sale_items_amounts_check" CHECK (unit_price >= 0 AND line_total >= 0);
--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_tax_pct_check" CHECK (tax_pct >= 0 AND tax_pct <= 100);
--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_amounts_check" CHECK (subtotal >= 0 AND tax_amount >= 0 AND total >= 0);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_price_check" CHECK (price >= 0);
