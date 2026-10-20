ALTER TABLE "courses" ADD CONSTRAINT "courses_id_org_key" UNIQUE("id","org_id");--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_id_org_key" UNIQUE("id","org_id");--> statement-breakpoint
ALTER TABLE "review_forms" ADD CONSTRAINT "review_forms_id_org_key" UNIQUE("id","org_id");--> statement-breakpoint
ALTER TABLE "review_periods" ADD CONSTRAINT "review_periods_id_org_key" UNIQUE("id","org_id");