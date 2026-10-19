ALTER TABLE "organizations" ADD COLUMN "workos_org_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_workos_org_id_unique" UNIQUE("workos_org_id");