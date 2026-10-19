-- cubic P1 0012:1 / P2 0012:2 / schema.ts:449 — 0012 immutable; reconciliation
-- (backfill + dedupe) jalan SEBELUM constraint diterapkan.

-- (b) Backfill legacy daily rows (blindspot 0012:2): 0012 melabel SEMUA baris
-- lama jadi 'manual' tanpa daily_for_date, jadi generator hari-H tak melihat
-- task yang sudah digenerate (judul sama) dan membuat duplikat. Baris legacy
-- dengan due_date dibalikkan jadi daily (daily_for_date = due_date) —
-- KECUALI kuncinya sudah dipakai daily yang ada (biarkan manual; generator
-- tidak akan menduplikasi karena daily-nya sudah terlihat).
UPDATE "tasks" AS t
SET "source" = 'daily', "daily_for_date" = t."due_date"
WHERE t."source" = 'manual' AND t."due_date" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "tasks" AS d
    WHERE d."org_id" = t."org_id"
      AND d."project_id" = t."project_id"
      AND d."daily_for_date" IS NOT DISTINCT FROM t."due_date"
      AND d."title" = t."title"
      AND d."source" = 'daily'
  );--> statement-breakpoint

-- (a) Dedupe kunci harian (org, project, daily_for_date, title) — keep
-- earliest created_at. Menutup daily duplikat dari DB pra-0012 yang index
-- lamanya menganggap NULL berbeda-beda. Loser DIDEMOSI ke 'manual' (bukan
-- delete) supaya timesheet yang menunjuk task itu tidak ikut terhapus.
UPDATE "tasks" AS loser
SET "source" = 'manual', "daily_for_date" = NULL
FROM "tasks" AS keep
WHERE loser."org_id" = keep."org_id"
  AND loser."project_id" = keep."project_id"
  AND loser."daily_for_date" IS NOT DISTINCT FROM keep."daily_for_date"
  AND loser."title" = keep."title"
  AND loser."source" = 'daily' AND keep."source" = 'daily'
  AND (loser."created_at", loser."id") > (keep."created_at", keep."id");--> statement-breakpoint

-- (c) cubic schema.ts:449 — NULL dianggap berbeda di unique index, jadi daily
-- tanpa tanggal bisa lolos idempotensi. Backstop CHECK.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_daily_date_required" CHECK (source <> 'daily' OR daily_for_date IS NOT NULL);
-- (d) Partial unique index tasks_org_project_daily_title_unique (dari 0012)
-- sudah konsisten setelah dedupe: loser keluar dari partial index
-- (source='manual'). Tidak perlu rebuild.
