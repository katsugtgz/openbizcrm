CREATE TYPE "public"."drive_file_status" AS ENUM('pending', 'confirmed');--> statement-breakpoint
ALTER TABLE "drive_files" ADD COLUMN "status" "drive_file_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "drive_files" ADD COLUMN "confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "drive_files" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
UPDATE "drive_files" SET "status" = 'confirmed', "confirmed_at" = "created_at";--> statement-breakpoint
CREATE INDEX "drive_files_pending_expires_idx" ON "drive_files" USING btree ("status","expires_at");
