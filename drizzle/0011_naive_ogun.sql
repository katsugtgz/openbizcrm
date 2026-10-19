ALTER TABLE "crm_deals" DROP CONSTRAINT "crm_deals_stage_id_crm_stages_id_fk";
--> statement-breakpoint
DROP INDEX "crm_companies_org_idx";--> statement-breakpoint
ALTER TABLE "crm_deals" ALTER COLUMN "value" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_stage_id_crm_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."crm_stages"("id") ON DELETE restrict ON UPDATE no action;