-- bughunt batch1 cubic pr10 follow-ups: composite FK ON DELETE SET NULL
-- -> restrict (PG would null org_id NOT NULL); tenant bindings NOT NULL
-- (orphans dropped, same treatment 0029 gave org-less audit rows);
-- pos sale_date backfilled from the audit stamp; WA claim lease column;
-- one user = one employee per org.
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_parent_org_fk";
--> statement-breakpoint
ALTER TABLE "crm_deals" DROP CONSTRAINT "crm_deals_company_org_fk";
--> statement-breakpoint
ALTER TABLE "crm_deals" DROP CONSTRAINT "crm_deals_contact_org_fk";
--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT "employees_branch_org_fk";
--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT "employees_department_org_fk";
--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT "employees_position_org_fk";
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_contact_org_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_company_org_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_parent_org_fk";
--> statement-breakpoint
-- cubic pr10 0029:84 follow-up: tenant bindings become NOT NULL after
-- a final backfill; orphan rows (conversation gone) are dropped.
DELETE FROM "ai_messages" AS m WHERE m."org_id" IS NULL AND NOT EXISTS (SELECT 1 FROM "ai_conversations" AS c WHERE c."id" = m."conversation_id");
--> statement-breakpoint
UPDATE "ai_messages" AS m SET "org_id" = c."org_id" FROM "ai_conversations" AS c WHERE m."conversation_id" = c."id" AND m."org_id" IS NULL;
--> statement-breakpoint
DELETE FROM "ai_messages" WHERE "org_id" IS NULL;
--> statement-breakpoint
DELETE FROM "chat_conversation_members" AS m WHERE m."org_id" IS NULL AND NOT EXISTS (SELECT 1 FROM "chat_conversations" AS c WHERE c."id" = m."conversation_id");
--> statement-breakpoint
UPDATE "chat_conversation_members" AS m SET "org_id" = c."org_id" FROM "chat_conversations" AS c WHERE m."conversation_id" = c."id" AND m."org_id" IS NULL;
--> statement-breakpoint
DELETE FROM "chat_conversation_members" WHERE "org_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "ai_messages" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_conversation_members" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
-- cubic pr10 pos:366: business date for every sale; legacy rows inherit
-- the audit stamp, then NOT NULL is enforced.
ALTER TABLE "pos_sales" ADD COLUMN "sale_date" date;--> statement-breakpoint
-- WIB (Asia/Jakarta): created_at is timestamptz. A bare ::date uses the
-- session TimeZone and can shift the day, so convert to WIB first.
UPDATE "pos_sales" SET "sale_date" = ("created_at" AT TIME ZONE 'Asia/Jakarta')::date WHERE "sale_date" IS NULL;--> statement-breakpoint
ALTER TABLE "pos_sales" ALTER COLUMN "sale_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_outbox" ADD COLUMN "claimed_at" timestamp;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_org_fk" FOREIGN KEY ("org_id","parent_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_company_org_fk" FOREIGN KEY ("company_id","org_id") REFERENCES "public"."crm_companies"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_contact_org_fk" FOREIGN KEY ("contact_id","org_id") REFERENCES "public"."crm_contacts"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_org_fk" FOREIGN KEY ("branch_id","org_id") REFERENCES "public"."branches"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_org_fk" FOREIGN KEY ("department_id","org_id") REFERENCES "public"."departments"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_org_fk" FOREIGN KEY ("position_id","org_id") REFERENCES "public"."positions"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contact_org_fk" FOREIGN KEY ("contact_id","org_id") REFERENCES "public"."crm_contacts"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_org_fk" FOREIGN KEY ("client_company_id","org_id") REFERENCES "public"."crm_companies"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_org_fk" FOREIGN KEY ("parent_id","org_id") REFERENCES "public"."tasks"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_user_unique" UNIQUE("org_id","user_id");