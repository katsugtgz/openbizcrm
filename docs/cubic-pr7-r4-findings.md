<!-- cubic:review-summary:start -->
**1 existing issue remains and 4 new issues found** across 50 files
<!-- cubic:review-summary:end -->

<details>
<summary>Prompt for AI agents (unresolved issues)</summary>

```text

Check if these issues are valid — if so, understand the root cause of each and fix them. When an issue isn't valid or won't be fixed in this PR, reply in its thread with the reason and then resolve the thread. If appropriate, use sub-agents to investigate and fix each issue separately.


<file name="drizzle/0015_daily-date-repair.sql">

<violation number="1" location="drizzle/0015_daily-date-repair.sql:16">
P1: This repair omits 0014's legacy manual-task backfill. Databases left unchanged after 0014 fails retain `source='manual'` rows with `due_date`, so the daily generator ignores them and creates duplicates; repeat the 0014 backfill after dropping the index, before deduplication.</violation>

<violation number="2" location="drizzle/0015_daily-date-repair.sql:16">
P1: This repair migration cannot repair a normally failed 0014 through the migration runner: 0014 fails first and blocks 0015 from executing. Move the cleanup into a migration that can run before the failing migration, or document an explicit operator repair/mark-0014-applied procedure.</violation>
</file>

<file name="docs/cubic-pr7-r3-findings.md">

<violation number="1" location="docs/cubic-pr7-r3-findings.md:88">
P3: The priority totals do not match the resolution table: it contains four P1 rows, not three. Correct the breakdown to match the rows, distinguishing the old issue if it is excluded from the new-issue counts.</violation>
</file>

<file name="src/lib/tasks/service.ts">

<violation number="1" location="src/lib/tasks/service.ts:64">
P2: `assertNotDescendant` is not atomic with `updateTask`, so concurrent parent changes can each pass this loop and commit `A.parentId = B` and `B.parentId = A`. Run the ancestry check and update under a project/row lock, or otherwise serialize parent mutations.</violation>
</file>
```

</details>

<sub>**Requires human review**: Auto-approval blocked because this review re-detected 1 unresolved issue already reported by Cubic.<br /><br />[View guided diff](https://www.cubic.dev/pr/katsugtgz/openbizcrm/pull/7?utm_source=github&utm_medium=review_footer) | [Turn on auto-fix](https://www.cubic.dev/action/auto-fix/pr/katsugtgz/openbizcrm/7?returnTo=https%3A%2F%2Fgithub.com%2Fkatsugtgz%2Fopenbizcrm%2Fpull%2F7) | [Re-trigger cubic](https://www.cubic.dev/action/re-review/pr/katsugtgz/openbizcrm/7/ai_pr_review_1792426412728_13d8490c-c063-47ef-90e6-8f3d867e2a13?returnTo=https%3A%2F%2Fgithub.com%2Fkatsugtgz%2Fopenbizcrm%2Fpull%2F7)</sub>

<!-- cubic:review-post:ai_pr_review_1792426412728_13d8490c-c063-47ef-90e6-8f3d867e2a13:ac825264c87de444df3868c050dac3ea3adf9931:988ef8c6-db80-5736-bc64-b68a09c1ce21 -->