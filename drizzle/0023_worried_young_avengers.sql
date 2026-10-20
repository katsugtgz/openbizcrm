-- bughunt data-tenant: ALTER TYPE ... ADD VALUE cannot run inside a transaction
-- block (PG 55000), but drizzle migrate wraps every migration in one
-- transaction (drizzle-orm PgDialect.migrate). Add 'sending' with a
-- transactional type replacement instead; final state identical.
ALTER TABLE "whatsapp_outbox" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
CREATE TYPE "public"."whatsapp_outbox_status_new" AS ENUM('queued', 'sending', 'sent', 'failed');--> statement-breakpoint
ALTER TABLE "whatsapp_outbox" ALTER COLUMN "status" TYPE "public"."whatsapp_outbox_status_new" USING "status"::text::"public"."whatsapp_outbox_status_new";--> statement-breakpoint
ALTER TABLE "whatsapp_outbox" ALTER COLUMN "status" SET DEFAULT 'queued';--> statement-breakpoint
DROP TYPE "public"."whatsapp_outbox_status";--> statement-breakpoint
ALTER TYPE "public"."whatsapp_outbox_status_new" RENAME TO "whatsapp_outbox_status";
