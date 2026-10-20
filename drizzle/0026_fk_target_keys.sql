-- bughunt data-tenant: composite tenant FKs reference the UNIQUEs created
-- in 0025 (statement order swapped; final state unchanged).
ALTER TABLE "course_completions" DROP CONSTRAINT "course_completions_course_id_courses_id_fk";
--> statement-breakpoint
ALTER TABLE "course_materials" DROP CONSTRAINT "course_materials_course_id_courses_id_fk";
--> statement-breakpoint
ALTER TABLE "review_assignments" DROP CONSTRAINT "review_assignments_period_id_review_periods_id_fk";
--> statement-breakpoint
ALTER TABLE "review_periods" DROP CONSTRAINT "review_periods_form_id_review_forms_id_fk";
--> statement-breakpoint
ALTER TABLE "review_responses" DROP CONSTRAINT "review_responses_assignment_id_review_assignments_id_fk";
--> statement-breakpoint
ALTER TABLE "course_completions" ADD CONSTRAINT "course_completions_course_org_fk" FOREIGN KEY ("course_id","org_id") REFERENCES "public"."courses"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_course_org_fk" FOREIGN KEY ("course_id","org_id") REFERENCES "public"."courses"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_period_org_fk" FOREIGN KEY ("period_id","org_id") REFERENCES "public"."review_periods"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_periods" ADD CONSTRAINT "review_periods_form_org_fk" FOREIGN KEY ("form_id","org_id") REFERENCES "public"."review_forms"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_assignment_org_fk" FOREIGN KEY ("assignment_id","org_id") REFERENCES "public"."review_assignments"("id","org_id") ON DELETE cascade ON UPDATE no action;