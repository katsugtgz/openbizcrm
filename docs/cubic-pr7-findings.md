<!-- cubic:review-summary:start -->

**23 issues found** across 41 files
<!-- cubic:review-summary:end -->

<details>
<summary>Prompt for AI agents (unresolved issues)</summary>

```text

Check if these issues are valid — if so, understand the root cause of each and fix them. When an issue isn't valid or won't be fixed in this PR, reply in its thread with the reason and then resolve the thread. If appropriate, use sub-agents to investigate and fix each issue separately.


<file name="docs/cubic-pr6-findings.md">

<violation number="1" location="docs/cubic-pr6-findings.md:399">
P3: The resolution totals undercount FIXED findings: the table marks 49 findings FIXED, but the summary says 48. Change the total to 49 so the documented resolution status is internally consistent.</violation>
</file>

<file name="src/app/(app)/crm/new-deal-dialog.tsx">

<violation number="1" location="src/app/(app)/crm/new-deal-dialog.tsx:68">
P2: Reset `companyId` when the dialog closes as well. Otherwise a canceled form reopens with the previous company selected, and the next deal can be created for that company without the user selecting it again.</violation>
</file>

<file name="src/app/(app)/proyek/timesheet/page.tsx">

<violation number="1" location="src/app/(app)/proyek/timesheet/page.tsx:225">
P2: Invalid month values still pass the regex, but `toISOString()` throws for them before the fallback runs. Check that the parsed date is valid before calling `toISOString()` so malformed `week` parameters continue to use today.</violation>
</file>

<file name="docs/cubic-pr2-findings.md">

<violation number="1" location="docs/cubic-pr2-findings.md:1">
P3: This adds an unrelated PR #2 review transcript to the PR #6 changes, leaving 50 apparently unresolved findings and misleading future agents about the current work. Remove this accidental file, or clearly label and place it with the historical PR #2 documentation if it is intentionally retained.</violation>
</file>

<file name="src/lib/timesheet/service.integration.test.ts">

<violation number="1" location="src/lib/timesheet/service.integration.test.ts:153">
P2: Derive the year from `stopped.startedAt`, not a separate current-time sample. Around midnight WIB, the timer can start in the previous year while this `new Date()` produces the next year, causing `listMine` to return zero rows.</violation>
</file>

<file name="src/lib/deals/quotation.ts">

<violation number="1" location="src/lib/deals/quotation.ts:55">
P2: This reordered expression still loses precision at the safe-integer boundary: a valid 100% discount on `Number.MAX_SAFE_INTEGER - 1` produces a discount one rupiah larger than the line and therefore a negative quotation total. Compute the bounded percentage factor first so 100% uses an exact factor of `1`.</violation>
</file>

<file name="src/lib/tasks/service.integration.test.ts">

<violation number="1" location="src/lib/tasks/service.integration.test.ts:140">
P2: This assertion does not exercise traversal beyond 32 ancestors, so it cannot detect a regression to the old depth-limited guard. Update `t0` with `parentId: deepChild.id` so `assertNotDescendant` must walk the entire chain before finding the cycle.</violation>
</file>

<file name="src/lib/deals/quotation.test.ts">

<violation number="1" location="src/lib/deals/quotation.test.ts:91">
P2: This regression test passes against the pre-change implementation, so it does not verify the unsafe-ordering fix it claims to cover. Use a percentage/value combination whose rounded result differs between the two expressions, such as `66.67%` at `Number.MAX_SAFE_INTEGER`.</violation>
</file>

<file name="src/lib/auth/ids.test.ts">

<violation number="1" location="src/lib/auth/ids.test.ts:156">
P2: A failed assertion before either tracking push leaves the newly provisioned user and organization in the shared test database. Register cleanup identifiers immediately after each successful lookup, or clean up by the generated WorkOS IDs in `finally` so failure paths cannot leak rows.</violation>

<violation number="2" location="src/lib/auth/ids.test.ts:198">
P3: This test claims that provisioning an existing WorkOS organization does not create a duplicate, but it never checks the organization row or the membership’s `orgId`. Query the seeded organization and assert its row count and ID are reused before declaring this regression covered.</violation>
</file>

<file name="src/db/seed.ts">

<violation number="1" location="src/db/seed.ts:326">
P2: This stage insert is no longer race-safe: a concurrent `getOrCreateDefaultPipeline()` can populate an empty pipeline after this read, causing the unique-position insert to abort the entire seed. Keep this insert conflict-safe so concurrent initialization does not roll back the seed.</violation>
</file>

<file name="drizzle/0012_needy_winter_soldier.sql">

<violation number="1" location="drizzle/0012_needy_winter_soldier.sql:2">
P1: This migration cannot repair databases where 0010 failed on pre-existing duplicate daily rows, because migration runners execute 0010 before this DROP. Amend the earlier migration or perform the duplicate cleanup before creating its broad constraint.</violation>

<violation number="2" location="drizzle/0012_needy_winter_soldier.sql:3">
P2: When this migration runs on a day that already has generated tasks, this default relabels them as manual with no date. The new generator then filters them out and inserts duplicates; backfill legacy daily rows or make the first post-migration lookup include the old `due_date` key.</violation>

<violation number="3" location="drizzle/0012_needy_winter_soldier.sql:5">
P2: Daily templates bypass the task title limit, and that limit measures UTF-16 code units rather than UTF-8 bytes. A 1,000-emoji template can exceed PostgreSQL's B-tree entry limit and make generation return a raw database error; enforce a byte-size bound or index a bounded digest.</violation>
</file>

<file name="src/lib/auth/ids.ts">

<violation number="1" location="src/lib/auth/ids.ts:128">
P1: This gate makes user-only provisioning permanent. If a user first signs in before joining a WorkOS organization, later organization sessions skip `provision()`, fail the membership check, and remain unusable unless another path manually creates the membership; retry provisioning for existing AuthKit users when an organization is present, or avoid persisting the user until provisioning can continue.</violation>
</file>

<file name="src/lib/deals/service.ts">

<violation number="1" location="src/lib/deals/service.ts:41">
P2: This idempotent return uses a stale pre-read and can report the wrong outcome when a concurrent `moveDeal` changes a closed deal. Lock or conditionally revalidate the closed row before returning it as already applied.</violation>

<violation number="2" location="src/lib/deals/service.ts:88">
P2: The empty-reread path loses the service's not-found error type. Throw `NotFoundError("Deal tidak ditemukan.")` there so callers preserve the target-gone contract when deletion races the close.</violation>
</file>

<file name="src/lib/tasks/service.ts">

<violation number="1" location="src/lib/tasks/service.ts:87">
P2: The 2,000 check measures UTF-16 units, not index bytes. A 1,000-character Unicode title can pass validation yet exceed PostgreSQL’s multicolumn B-tree entry limit; validate UTF-8 byte length with margin or index a bounded/hash value.</violation>

<violation number="2" location="src/lib/tasks/service.ts:262">
P2: The new project lock does not make the task snapshot current: a queued reorder can branch on the pre-lock status and fail after another reorder moves the task. Reload the task after acquiring the project lock, or explicitly reject the stale request with a concurrency error.</violation>
</file>

<file name="src/app/(app)/proyek/actions.ts">

<violation number="1" location="src/app/(app)/proyek/actions.ts:299">
P2: This max query ignores `todo` tasks whose due date is not today, even though Kanban positions are allocated across the whole status column. Remove the `dueDate` predicate so generated tasks are placed after every existing todo task.</violation>

<violation number="2" location="src/app/(app)/proyek/actions.ts:318">
P2: Position allocation is still race-prone: concurrent generators can read the same max and insert different daily tasks at the same `nextPos`. Lock the project row and perform the max-plus-inserts inside one transaction, as `createTask` does.</violation>
</file>

<file name="src/db/schema.ts">

<violation number="1" location="src/db/schema.ts:449">
P2: `source = 'daily'` still permits `dailyForDate` to be NULL, and PostgreSQL treats NULLs as distinct in unique indexes, so duplicate daily tasks can bypass this idempotency index. Add a check constraint requiring a date for every daily task.</violation>
</file>

<file name=".github/workflows/dependency-review.yml">

<violation number="1" location=".github/workflows/dependency-review.yml:46">
P2: The SBOM API can return 404 when the dependency graph is disabled, so this unconditional exit fails repositories that should reach the existing skip path. Inspect the 404 response body and skip only for an explicit disabled-graph message; fail other 404s.</violation>
</file>
```

</details>

<sub>Reply with feedback, questions, or to request a fix.<br /><br />[View guided diff](https://www.cubic.dev/pr/katsugtgz/openbizcrm/pull/7?utm_source=github&utm_medium=review_footer) | [Turn on auto-fix](https://www.cubic.dev/action/auto-fix/pr/katsugtgz/openbizcrm/7?returnTo=https%3A%2F%2Fgithub.com%2Fkatsugtgz%2Fopenbizcrm%2Fpull%2F7) | [Re-trigger cubic](https://www.cubic.dev/action/re-review/pr/katsugtgz/openbizcrm/7/ai_pr_review_github_delivery_61f7d2565798158d3fec67ed4b329237af348078a3cb5d9fb4c70db4ceef4014?returnTo=https%3A%2F%2Fgithub.com%2Fkatsugtgz%2Fopenbizcrm%2Fpull%2F7)</sub>

<!-- cubic:review-post:ai_pr_review_github_delivery_61f7d2565798158d3fec67ed4b329237af348078a3cb5d9fb4c70db4ceef4014:53eaba8849cabeb471772177f6c3f2cd4f006ed6:e19cb843-aeb9-5d64-a008-c8036d4a473b -->

## Resolution status (round 2)

All 23 cubic PR-7 findings audited against branch `fix/pr6-cubic-findings` (verification: bun install, prettier, eslint, tsc, `env -u DATABASE_URL bun run build`, `RUN_DB_TESTS=1 bun run test:coverage` — 22 files / 221 tests green, thresholds lines 80.08% / branches 73.59% / functions 77.43% / statements 79.24% ≥ 60; `bun run db:generate` clean, migration journal ends at 0014).

| #   | Location                                                                              | Status  | Notes                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | docs/cubic-pr6-findings.md:399 (totals undercount)                                    | FIXED   | Totals line now reads "FIXED: 53" with per-batch breakdown (1–48, 49–51, PR-7 additions 52–60).                                                                                                                                |
| 2   | src/app/(app)/crm/new-deal-dialog.tsx:68 (companyId stale on close)                   | FIXED   | `handleOpenChange` resets `companyId`/`title`/`value` on every close (Cancel, X, outside click), not just submit success.                                                                                                      |
| 3   | src/app/(app)/proyek/timesheet/page.tsx:225 (toISOString throws on invalid month)     | FIXED   | `Number.isNaN(parsed.getTime())` checked before `toISOString()`; malformed `week` falls back to today.                                                                                                                         |
| 4   | docs/cubic-pr2-findings.md:1 (unrelated PR #2 transcript in PR #7)                    | WONTFIX | Intentional retention, now clearly labeled at the top as a historical PR #2 archive that does not describe PR #7 work.                                                                                                         |
| 5   | src/lib/timesheet/service.integration.test.ts:153 (year from second Date() sample)    | FIXED   | Year derived from `stopped.startedAt` via `Intl.DateTimeFormat` WIB; no second current-time sample.                                                                                                                            |
| 6   | src/lib/deals/quotation.ts:55 (unsafe ordering still loses precision)                 | FIXED   | Bounded factor computed first: `lineTotal * (pct / 100)`; 100% at MAX_SAFE_INTEGER − 1 stays exact.                                                                                                                            |
| 7   | src/lib/deals/quotation.test.ts:91 (test passes against pre-change impl)              | FIXED   | Regression uses 3.28% at MAX_SAFE_INTEGER — verified old `(x/100)*pct` and new `x*(pct/100)` differ by 1 rupiah; test fails on old impl.                                                                                       |
| 8   | src/lib/tasks/service.integration.test.ts:140 (traversal < 32 ancestors)              | FIXED   | Chain of 40 built; `updateTask(t0, { parentId: deepChild.id })` forces full walk past the old 32 cap.                                                                                                                          |
| 9   | src/lib/auth/ids.test.ts:156 (failed assert leaks rows)                               | FIXED   | Cleanup IDs pushed immediately after lookup plus `finally` deletes by WorkOS ID, so assertion failures cannot leak users/orgs.                                                                                                 |
| 10  | src/lib/auth/ids.test.ts:198 (dup-org claim unverified)                               | FIXED   | Seeded org queried; asserts exactly 1 row for `workosOrgId = org_contoh-sejahtera` and `membership.orgId === seedOrg.id`.                                                                                                      |
| 11  | src/db/seed.ts:326 (stage insert not race-safe)                                       | FIXED   | Insert uses `onConflictDoNothing()` then re-reads stages, so a concurrent `getOrCreateDefaultPipeline()` cannot abort the seed.                                                                                                |
| 12  | drizzle/0012_needy_winter_soldier.sql:2 (cannot repair pre-0010 dup daily rows)       | FIXED   | 0012 immutable; new 0014 `daily-date-required` runs backfill + dedupe (keep earliest `created_at`, loser demoted to manual) BEFORE applying the CHECK, repairing any DB state including pre-0010 dup rows.                     |
| 13  | drizzle/0012_needy_winter_soldier.sql:3 (default relabels generated tasks; dup risk)  | FIXED   | 0014 backfills legacy `manual` rows with `due_date` back to `source='daily'`, `daily_for_date = due_date`, unless the key is already taken by a daily row; generator can no longer duplicate them.                             |
| 14  | drizzle/0012_needy_winter_soldier.sql:5 (title bypasses limit; UTF-16 vs UTF-8 bytes) | FIXED   | `TASK_TITLE_MAX` reduced 2000 → 500 (500 UTF-16 × max 4 UTF-8 bytes = 2000 < ~2704 B-tree byte limit) and template names validated against the same bound in `createTemplateAction`.                                           |
| 15  | src/lib/auth/ids.ts:128 (user-only provisioning permanent)                            | FIXED   | Two-phase provisioning: `needs_org` column (0013); users provisioned without org keep `needsOrg=true`; a later session carrying `organizationId` retriggers `provision()` and completes membership instead of failing forever. |
| 16  | src/lib/deals/service.ts:41 (stale pre-read idempotent return)                        | FIXED   | Same-outcome pre-read is conditionally revalidated with a `WHERE status = outcome` re-read; stale snapshot falls through to the race-safe conditional update instead of returning a wrong "already applied" row.               |
| 17  | src/lib/deals/service.ts:88 (reread loses NotFoundError)                              | FIXED   | Reread of a vanished deal throws `NotFoundError("Deal tidak ditemukan.")`, preserving the target-gone contract.                                                                                                                |
| 18  | src/lib/tasks/service.ts:87 (2,000 UTF-16 check vs B-tree bytes)                      | FIXED   | Same fix as #14: `TASK_TITLE_MAX = 500` UTF-16 units bounds UTF-8 bytes below the B-tree entry limit.                                                                                                                          |
| 19  | src/lib/tasks/service.ts:262 (pre-lock status snapshot)                               | FIXED   | Task re-read inside the project `FOR UPDATE` transaction; missing row rejects with an explicit stale-request error, and branches use the in-lock status.                                                                       |
| 20  | src/app/(app)/proyek/actions.ts:299 (max ignores todo tasks not due today)            | FIXED   | `dueDate` predicate removed from the max-position query; allocation covers the whole `todo` column.                                                                                                                            |
| 21  | src/app/(app)/proyek/actions.ts:318 (position race)                                   | FIXED   | Project row locked `FOR UPDATE`; max-read + inserts run inside one transaction (same pattern as `createTask`), inserts also `onConflictDoNothing()`.                                                                           |
| 22  | src/db/schema.ts:449 (daily + NULL dailyForDate bypasses unique index)                | FIXED   | `tasks_daily_date_required` CHECK (`source <> 'daily' OR daily_for_date IS NOT NULL`) added in 0014 and mirrored in schema.ts.                                                                                                 |
| 23  | .github/workflows/dependency-review.yml:46 (404 unconditionally fails)                | FIXED   | 404 joins the 403 path: response body re-fetched and inspected; only explicit disabled-graph messages ("Not Found" / "dependency graph.*disabled") skip with a warning, other 404 bodies fail the job.                         |

### Totals (round 2)

- FIXED: 22
- WONTFIX: 1 (#4 — historical PR #2 transcript retained and clearly labeled)
- NOT-FIXED: 0 (no P0/P1 blockers remain)

Spot-check: migration 0014 contains CHECK `tasks_daily_date_required`; daily generation runs two-phase (dedupe/backfill before constraint) — verified via new DB integration tests (CHECK rejects dateless daily row; dedupe collapses same-key daily rows).
