CREATE TYPE "public"."task_source" AS ENUM('manual', 'daily');--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_org_project_title_due_unique";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source" "task_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "daily_for_date" date;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_org_project_daily_title_unique" ON "tasks" USING btree ("org_id","project_id","daily_for_date","title") WHERE source = 'daily';