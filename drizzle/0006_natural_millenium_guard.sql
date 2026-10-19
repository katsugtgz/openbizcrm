ALTER TABLE "users" DROP CONSTRAINT "users_current_org_id_organizations_id_fk";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_current_org_id_organizations_id_fk" FOREIGN KEY ("current_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("org_id","created_at");
