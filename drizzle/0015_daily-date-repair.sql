-- cubic P1 drizzle/0014:11 & :38 — 0014 IMMUTABLE (tidak boleh disunting);
-- 0015 memperbaiki DB di mana 0014 GAGAL atau ter-apply parsial:
--   (a) turunkan partial unique index lebih dulu — backfill/dedupe bisa
--       menyentuh kunci yang sedang dijaga index itu (akar abort 0014).
--   (b) daily tanpa tanggal diperbaiki SEBELUM CHECK dipasang:
--       b1) daily_for_date dipulihkan dari due_date;
--       b2) masih NULL (due_date NULL) → demosi ke 'manual'.
--   (c) dedupe kunci harian (org, project, daily_for_date, title) — keep
--       earliest created_at (tiebreak id), loser demosi 'manual' bukan
--       dihapus agar timesheet tetap menunjuk task yang valid.
--   (d) CHECK + partial unique index dipasang ulang di atas data yang kini
--       konsisten.
-- Semua langkah ber-guard IF EXISTS / IF NOT EXISTS → aman dijalankan ulang.

-- (a)
DROP INDEX IF EXISTS "tasks_org_project_daily_title_unique";--> statement-breakpoint

-- (b1) pulihkan tanggal generate dari due_date
UPDATE "tasks"
SET "daily_for_date" = "due_date"
WHERE "source" = 'daily' AND "daily_for_date" IS NULL
  AND "due_date" IS NOT NULL;--> statement-breakpoint

-- (b2) tanpa due_date: demosi manual — CHECK tidak boleh gagal di sini
UPDATE "tasks"
SET "source" = 'manual'
WHERE "source" = 'daily' AND "daily_for_date" IS NULL;--> statement-breakpoint

-- (c) dedupe: keep earliest created_at, loser keluar dari partial index
UPDATE "tasks" AS loser
SET "source" = 'manual', "daily_for_date" = NULL
FROM "tasks" AS keep
WHERE loser."org_id" = keep."org_id"
  AND loser."project_id" = keep."project_id"
  AND loser."daily_for_date" IS NOT DISTINCT FROM keep."daily_for_date"
  AND loser."title" = keep."title"
  AND loser."source" = 'daily' AND keep."source" = 'daily'
  AND (loser."created_at", loser."id") > (keep."created_at", keep."id");--> statement-breakpoint

-- (d1) backstop CHECK — drop lalu add agar idempoten (PG tak punya
-- ADD CONSTRAINT IF NOT EXISTS)
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_daily_date_required";--> statement-breakpoint

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_daily_date_required" CHECK (source <> 'daily' OR daily_for_date IS NOT NULL);--> statement-breakpoint

-- (d2) index dipasang ulang SETELAH data konsisten
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_org_project_daily_title_unique"
ON "tasks" USING btree ("org_id","project_id","daily_for_date","title") WHERE source = 'daily';
