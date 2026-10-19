<!-- cubic:review-summary:start -->

**1 existing issue remains and 10 new issues found** across 46 files
<!-- cubic:review-summary:end -->

<details>
<summary>Prompt for AI agents (unresolved issues)</summary>

```text

Check if these issues are valid — if so, understand the root cause of each and fix them. When an issue isn't valid or won't be fixed in this PR, reply in its thread with the reason and then resolve the thread. If appropriate, use sub-agents to investigate and fix each issue separately.


<file name="src/lib/deals/service.ts">

<violation number="1" location="src/lib/deals/service.ts:90">
P1: This predicate serializes concurrent closes but not `moveDeal`: a move that read an open deal can write afterward and reopen or retarget the deal after `closeDeal` returns and audits it. Add an optimistic expected-state guard or transaction/locking protocol to `moveDeal` so a close cannot be overwritten.</violation>
</file>

<file name="src/lib/tasks/service.integration.test.ts">

<violation number="1" location="src/lib/tasks/service.integration.test.ts:196">
P2: This test removes a shared production-schema index and does not restore it in a `finally` block. Run the setup in a disposable schema/database or use transactional isolation so a failed test cannot corrupt later tests or local development data.</violation>

<violation number="2" location="src/lib/tasks/service.integration.test.ts:235">
P2: This migration test validates duplicated SQL, not `drizzle/0014_daily-date-required.sql`; changing the migration will not affect the test. Execute the actual migration against a pre-0014 fixture in an isolated database/schema, or keep this as a clearly separate algorithm test.</violation>
</file>

<file name="src/db/seed.ts">

<violation number="1" location="src/db/seed.ts:97">
P2: This backfill can abort the entire seed when `ORG_WORKOS_ID` is already attached to a different organization. Look up the existing WorkOS-ID row and handle that collision explicitly before assigning the fixed ID.</violation>
</file>

<file name="src/lib/auth/ids.test.ts">

<violation number="1" location="src/lib/auth/ids.test.ts:199">
P3: These restores leave absent `WORKOS_*` variables as the literal `"undefined"`, contaminating subsequent tests and configuration checks in the same worker. Delete each key when its saved value is `undefined`, or use Vitest’s `vi.stubEnv`/`vi.unstubAllEnvs` for restoration.</violation>
</file>

<file name="src/lib/auth/ids.ts">

<violation number="1" location="src/lib/auth/ids.ts:71">
P1: `onConflictDoNothing()` also swallows conflicts on the unique `organizations.slug` constraint. If an existing unmapped organization already uses this WorkOS ID as its slug, provisioning commits an orphaned user with `needsOrg=false`, and subsequent logins permanently skip the retry path; restrict this clause to the `workosOrgId` conflict (or roll back when no mapped org is found).</violation>
</file>

<file name="drizzle/0014_daily-date-required.sql">

<violation number="1" location="drizzle/0014_daily-date-required.sql:11">
P1: This backfill can abort on the existing partial unique index before the dedupe executes: two manual rows with the same project, title, and due date become duplicate daily rows in one UPDATE. Reconcile those candidates first or temporarily drop and recreate the partial index around the backfill.</violation>

<violation number="2" location="drizzle/0014_daily-date-required.sql:38">
P1: The dedupe leaves an earliest or lone `source='daily'` row with a NULL date, so `ALTER TABLE ... ADD CONSTRAINT` still fails on valid pre-0014 database state. Demote or repair every dateless daily row before adding this CHECK.</violation>
</file>

<file name="src/lib/tasks/service.ts">

<violation number="1" location="src/lib/tasks/service.ts:277">
P2: `readColumn` snapshots task rows without locking them, so concurrent task deletion can invalidate the reorder snapshot and leave inconsistent positions. Lock the current task and both column snapshots with `FOR UPDATE`, or serialize task deletion on the project lock before calculating and persisting positions.</violation>

<violation number="2" location="src/lib/tasks/service.ts:328">
P2: The reorder audit records a stale `from` status after the in-lock reread can observe an earlier queued move. Return the locked source status from the transaction and use it in the audit metadata.</violation>
</file>
```

</details>

<sub>**Requires human review**: Auto-approval blocked because this review re-detected 1 unresolved issue already reported by Cubic.<br /><br />[View guided diff](https://www.cubic.dev/pr/katsugtgz/openbizcrm/pull/7?utm_source=github&utm_medium=review_footer) | [Turn on auto-fix](https://www.cubic.dev/action/auto-fix/pr/katsugtgz/openbizcrm/7?returnTo=https%3A%2F%2Fgithub.com%2Fkatsugtgz%2Fopenbizcrm%2Fpull%2F7) | [Re-trigger cubic](https://www.cubic.dev/action/re-review/pr/katsugtgz/openbizcrm/7/ai_pr_review_1792422694719_822e87b7-68e8-4951-b72c-e6bd3e53fa3b?returnTo=https%3A%2F%2Fgithub.com%2Fkatsugtgz%2Fopenbizcrm%2Fpull%2F7)</sub>

<!-- cubic:review-post:ai_pr_review_1792422694719_822e87b7-68e8-4951-b72c-e6bd3e53fa3b:98107184aacb807c4c28542b6cf1182392722c59:b8bc47c3-6d72-56a3-b85d-e973d13a3ccf -->

## Resolution status (round 3)

| #   | Lokasi                                                                                       | Prioritas | Status    | Bukti                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------- | --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/lib/deals/service.ts:90` (moveDeal vs closeDeal)                                        | P1        | **FIXED** | `moveDeal` (src/lib/repos/crm-repo.ts:384) kini punya guard terminal (deal closed tak bisa dipindah) + predikat expected-state `WHERE status = deal.status` pada UPDATE; kalah race → re-read + error basi, audit pakai status pasca-guard. Test pin: `crm.integration.test.ts` "moveDeal on closed deal: stale queued move rejected". |
| 2   | `src/lib/tasks/service.integration.test.ts:196` (drop index tanpa finally)                   | P2        | **FIXED** | DROP index dipindah ke blok `try` dengan `finally` yang `create unique index if not exists` ulang — assertion gagal tetap memulihkan schema bersama.                                                                                                                                                                                   |
| 3   | `src/lib/tasks/service.integration.test.ts:235` (test SQL salinan, bukan file 0014)          | P2        | **FIXED** | Test diubah jadi algorithm-test EKSPLISIT (komentar header menyatakan itu, opsi kedua yang diizinkan finding); eksekusi verbatim file migrasi kini ada di test 0015 baru yang `readFile("drizzle/0015_daily-date-repair.sql")` + split breakpoint + jalankan dua kali (idempoten).                                                     |
| 4   | `src/db/seed.ts:97` (backfill abort saat ORG_WORKOS_ID bentrok)                              | P2        | **FIXED** | Lookup pemilik `workos_org_id` dulu: bebas → backfill normal; dibawa org lain → slug tetap dikenali lewat sufiks deterministik `${ORG_WORKOS_ID}-alt`, seed tidak abort.                                                                                                                                                               |
| 5   | `src/lib/auth/ids.test.ts:199` (restore env jadi string "undefined")                         | P3        | **FIXED** | Helper `restoreEnv` menghapus key yang tersimpan `undefined`, men-set ulang yang ada. Semua blok finally memakainya.                                                                                                                                                                                                                   |
| 6   | `src/lib/auth/ids.ts:71` (onConflictDoNothing menelan konflik slug)                          | P1        | **FIXED** | Insert org kini `.onConflictDoNothing({ target: organizations.workosOrgId })` SAJA; konflik slug melempar → transaksi rollback → resolver null → login berikutnya retry. Test pin: "slug collision: provisioning fails cleanly, user row NOT committed" (0 orphan user).                                                               |
| 7   | `drizzle/0014_daily-date-required.sql:11` (backfill abort di partial unique index)           | P1        | **FIXED** | 0014 IMMUTABLE (sudah ter-apply). Migrasi baru 0015: DROP index dulu → repair data → pasang ulang index di akhir. Test verbatim 0015 membuktikan re-run idempoten.                                                                                                                                                                     |
| 8   | `drizzle/0014_daily-date-required.sql:38` (dedupe sisakan daily tanpa tanggal → CHECK gagal) | P1        | **FIXED** | 0015 (b1) pulihkan `daily_for_date` dari `due_date`, (b2) demosi sisa daily tanpa tanggal ke 'manual', SEMUA sebelum CHECK dipasang ulang; dedupe (c) demosi loser, tidak menghapus.                                                                                                                                                   |
| 9   | `src/lib/tasks/service.ts:277` (readColumn tanpa lock)                                       | P2        | **FIXED** | Reorder: baris task `FOR UPDATE` di dalam lock project + kedua snapshot kolom `readColumn` `.for("update")`; `deleteTask` ikut mengunci project yang sama → delete di-serialize terhadap reorder.                                                                                                                                      |
| 10  | `src/lib/tasks/service.ts:328` (audit 'from' basi)                                           | P2        | **FIXED** | Transaksi mengembalikan `fromStatus` dari re-read in-lock; audit metadata memakai nilai itu. Test pin: "reorder audit 'from' reflects in-lock reread".                                                                                                                                                                                 |
| 11  | `src/lib/auth/ids.test.ts:156` (issue lama: baris bocor saat assertion gagal)                | P2        | **FIXED** | Cleanup id didaftarkan SEBELUM assertion berikutnya + `finally` fallback delete by `workosUserId`/`workosOrgId` — dua path menutup kegagalan assertion mana pun.                                                                                                                                                                       |

**Total: 11/11 FIXED (3 P1, 6 P2, 1 P3, 1 issue lama). Tidak ada WONTFIX.**
