<!-- cubic:review-summary:start -->

**60 issues found** across 40 files
<!-- cubic:review-summary:end -->

<details>
<summary>Prompt for AI agents (unresolved issues)</summary>

```text

Check if these issues are valid — if so, understand the root cause of each and fix them. When an issue isn't valid or won't be fixed in this PR, reply in its thread with the reason and then resolve the thread. If appropriate, use sub-agents to investigate and fix each issue separately.


<file name="src/app/(app)/proyek/actions.ts">

<violation number="1" location="src/app/(app)/proyek/actions.ts:39">
P0: Production project actions pass WorkOS IDs directly into UUID-only repository guards, so every authenticated project mutation fails before it reaches the database. Resolve the session user and organization to internal UUIDs before calling these services.</violation>

<violation number="2" location="src/app/(app)/proyek/actions.ts:266">
P2: `generateTodayAction` computes "today" with `toISOString()`, which is UTC. Between 00:00 and 07:00 WIB that returns the previous calendar day, so tasks get the wrong due date and the dedupe skips them. Use `jakartaDateISO(new Date())` from `@/lib/attendance/rules`, as attendance does.</violation>

<violation number="3" location="src/app/(app)/proyek/actions.ts:279">
P2: Daily generation is not idempotent: duplicate template names or concurrent requests bypass the pre-read and create duplicate tasks. Enforce uniqueness and perform the check-and-create operation atomically.</violation>
</file>

<file name="src/app/(app)/crm/actions.ts">

<violation number="1" location="src/app/(app)/crm/actions.ts:50">
P0: CRM operations fail in production AuthKit sessions because this action passes WorkOS `user_`/`org_` identifiers to the UUID-only org guard. Resolve both session identifiers to internal database UUIDs before calling CRM repositories.</violation>
</file>

<file name="src/app/(app)/proyek/harian/page.tsx">

<violation number="1" location="src/app/(app)/proyek/harian/page.tsx:49">
P2: The admin check runs inside the streamed `Suspense` child, so a member gets a generic crash after the header renders. Call `requireOrgRole` in `TugasHarianPage` before returning JSX, matching `karyawan/baru/page.tsx`, so unauthorized users are handled at the page boundary.</violation>

<violation number="2" location="src/app/(app)/proyek/harian/page.tsx:139">
P1: This page passes WorkOS session IDs into `requireOrgRole`, which accepts only internal database UUIDs, so the daily-task page fails for every normal AuthKit or fake session. Resolve the session user and organization to internal UUIDs before calling `TemplateSection`.</violation>
</file>

<file name="src/app/(app)/crm/perusahaan/page.tsx">

<violation number="1" location="src/app/(app)/crm/perusahaan/page.tsx:24">
P1: `Tables` passes AuthKit’s `user_…` and `org_…` identifiers to `requireOrgRole`, which accepts only internal UUIDs, so this page throws `UUIDContractError` in production. Resolve the authenticated user and active organization to internal IDs before rendering and before the create actions use them.</violation>

<violation number="2" location="src/app/(app)/crm/perusahaan/page.tsx:63">
P3: `contacts.filter` scans every contact once for each company, making this table render O(companies × contacts) as CRM data grows. Build a contact-count map in one pass and read the count by `c.id`.</violation>
</file>

<file name="src/app/(app)/proyek/[projectId]/page.tsx">

<violation number="1" location="src/app/(app)/proyek/[projectId]/page.tsx:43">
P1: The task read is not organization-scoped. A task row whose project reference and `orgId` disagree can leak into this project's board and assignee join; add `eq(tasksTable.orgId, orgId)` to the predicate.</violation>

<violation number="2" location="src/app/(app)/proyek/[projectId]/page.tsx:109">
P1: This page passes WorkOS or fake IDs into UUID-scoped queries, so valid project pages resolve as not found in production and the fallback can fail in fake mode. Resolve `user.id` with `getUserByWorkosId` and use the internal user and current-organization UUIDs before calling the project repo.</violation>

<violation number="3" location="src/app/(app)/proyek/[projectId]/page.tsx:135">
P2: The detail page advertises a project timesheet but renders only Kanban and Gantt, leaving users without a timesheet view or link from the project. Add the promised timesheet section/tab or remove it from the description.</violation>
</file>

<file name="src/lib/tasks/service.ts">

<violation number="1" location="src/lib/tasks/service.ts:106">
P2: Concurrent task creation can assign duplicate positions because the max-position read and insert are separate and positions are not unique. Serialize position allocation or use an atomic ordering strategy.</violation>

<violation number="2" location="src/lib/tasks/service.ts:129">
P2: The parent check permits self-parenting and cycles, which can break hierarchy traversal. Reject `parentId === taskId` and verify the proposed parent is not a descendant of the task.</violation>

<violation number="3" location="src/lib/tasks/service.ts:133">
P2: `updateTask` skips the invariants that `createTask` enforces. An empty title is accepted, and a `status` change leaves `position` unchanged, which can collide with existing positions in the new column. Validate the title and route status changes through the reorder logic.</violation>

<violation number="4" location="src/lib/tasks/service.ts:209">
P2: Cross-column moves never renumber the source column, leaving gaps in `position` values and violating the service’s renumbering contract. Renumber and persist the source column together with the target column.</violation>

<violation number="5" location="src/lib/tasks/service.ts:210">
P2: Within-column reorders skip the `task.reorder` audit entry that the between-column path writes. Record the audit before this return so both paths are logged.</violation>

<violation number="6" location="src/lib/tasks/service.ts:222">
P1: Cross-column drops land at the wrong place. `moveAndRenumber` returns no updates here, so the moved task keeps its old `position` and the target column's positions are never persisted. Persist the renumbered positions for the whole target column, including the moved task.</violation>
</file>

<file name="src/lib/timesheet/service.ts">

<violation number="1" location="src/lib/timesheet/service.ts:29">
P1: `stopTimer` can stop a timer belonging to another organization because the open-row lookup ignores `orgId`; scope that lookup to `timesheets.orgId = orgId` before updating and auditing the row.</violation>

<violation number="2" location="src/lib/timesheet/service.ts:117">
P2: `summaryByProject` returns project minute totals with no membership check. Every other function in this service calls `requireOrgRole`, so this one should take `userId` and call it as well. It also has no production caller, only the integration test.</violation>
</file>

<file name="src/app/(app)/crm/page.tsx">

<violation number="1" location="src/app/(app)/crm/page.tsx:40">
P1: The CRM board hides deals for every company except the alphabetically first one. Add a company selector or load and present all company pipelines so deals created for other companies remain visible.</violation>
</file>

<file name="src/app/(app)/crm/[dealId]/deal-actions.tsx">

<violation number="1" location="src/app/(app)/crm/[dealId]/deal-actions.tsx:104">
P1: `QUOT_LABEL` is exported from this `"use client"` file, and `page.tsx` (a server component) dot-accesses it. Server components cannot index into client-module exports, so the deal detail page will fail to render. Move `QUOT_LABEL` into a shared module without `"use client"` (e.g. `src/lib/deals/labels.ts`) and import it from both this file and `page.tsx`.</violation>
</file>

<file name="src/lib/repos/crm-repo.ts">

<violation number="1" location="src/lib/repos/crm-repo.ts:324">
P1: `createDeal` stores unchecked relationship IDs after only partial org checks. Verify the pipeline belongs to the org and company, the stage belongs to that pipeline, and the contact belongs to that company before inserting the deal.</violation>

<violation number="2" location="src/lib/repos/crm-repo.ts:329">
P2: `createDeal` ignores the stage outcome, so a deal created directly in Close Won or Close Lost is stored as `open` with no `closedAt`. Select the stage name and set `status` and `closedAt` from `stageOutcome(stage.name)`, as `moveDeal` does.</violation>
</file>

<file name="src/app/(app)/proyek/timesheet/page.tsx">

<violation number="1" location="src/app/(app)/proyek/timesheet/page.tsx:64">
P1: The timesheet page can display another organization’s open timer; add the current `orgId` predicate to `openTimerRows` so the banner remains tenant-scoped.</violation>

<violation number="2" location="src/app/(app)/proyek/timesheet/page.tsx:80">
P2: Day bucketing and the default week use UTC dates, but this app's Indonesian users are WIB (UTC+7). Work started before 07:00 WIB on Monday is excluded from the current week's total and shown under the previous Sunday. Compute the day key and week boundaries in Asia/Jakarta, as `jakartaDateISO` does, and make `listMine`'s range WIB-aware too.</violation>

<violation number="3" location="src/app/(app)/proyek/timesheet/page.tsx:152">
P2: `toLocaleString("id-ID")` uses the server's timezone, which is usually UTC in deployment, so the Mulai and Selesai times show 7 hours behind WIB. Pass `timeZone: "Asia/Jakarta"` for both timestamps.</violation>

<violation number="4" location="src/app/(app)/proyek/timesheet/page.tsx:209">
P2: A malformed calendar date in `?week=` (e.g. `2024-13-01`) passes the regex and makes `mondayOf` throw `RangeError: Invalid time value`, which crashes the page. Validate that the date parses before using it, and fall back to today otherwise.</violation>
</file>

<file name="src/app/(app)/proyek/[projectId]/task-board.tsx">

<violation number="1" location="src/app/(app)/proyek/[projectId]/task-board.tsx:134">
P2: Timer and delete buttons use `hidden` until hover, so keyboard users cannot focus them and touch users may never see them. Keep them in the layout and reveal them on hover or focus-within.</violation>

<violation number="2" location="src/app/(app)/proyek/[projectId]/task-board.tsx:182">
P2: The kanban supports pointer dragging only, leaving keyboard users unable to move tasks. Add a keyboard sensor and an accessible drag activator.</violation>

<violation number="3" location="src/app/(app)/proyek/[projectId]/task-board.tsx:214">
P2: The board can only drop on column containers, so same-column drags are always ignored and cross-column drags always append. Add card drop targets and calculate the insertion index from the card under the pointer.</violation>

<violation number="4" location="src/app/(app)/proyek/[projectId]/task-board.tsx:225">
P1: After a successful drop, the card snaps back to its original column while the toast says "Task dipindahkan." The action never revalidates the route, so the server-rendered `tasks` prop stays stale. Call `revalidatePath` in `reorderTaskAction` (pass `projectId` like the sibling actions), or call `router.refresh()` on success here.</violation>
</file>

<file name="src/lib/deals/quotation.ts">

<violation number="1" location="src/lib/deals/quotation.ts:44">
P2: Safe unit prices and integer quantities do not guarantee a safe line total. Check every multiplication and accumulated total for safe arithmetic, or use `bigint` for quotation calculations.</violation>
</file>

<file name="src/lib/timesheet/service.integration.test.ts">

<violation number="1" location="src/lib/timesheet/service.integration.test.ts:141">
P2: These cross-org checks use `owner`, who is not a member of `otherOrg`, so they fail at the membership check and never test the task org guard. Use `otherOwner` (a real member of `otherOrg`) and expect the `requireTask` NotFoundError, so the test covers the task-scoping path.</violation>

<violation number="2" location="src/lib/timesheet/service.integration.test.ts:144">
P2: The date range is hardcoded to 2026, so this test starts failing on 2027-01-01 because the timer rows fall outside the range. Derive the range from the current year, for example `${new Date().getUTCFullYear()}-01-01` to `${new Date().getUTCFullYear()}-12-31`, or use a wider range.</violation>
</file>

<file name="src/app/(app)/proyek/[projectId]/gantt.tsx">

<violation number="1" location="src/app/(app)/proyek/[projectId]/gantt.tsx:54">
P2: Tasks created and due on the same Monday get a zero-width bar, and when they are the only dated tasks the empty-state message appears. The cause is `last` rolling forward to the next Monday with a strict `d < last` loop, plus `colEnd` using `w < e`. Use the Monday of `max` without roll-forward, loop with `d <= last`, and count `w <= e` so a due date always includes its own week.</violation>

<violation number="2" location="src/app/(app)/proyek/[projectId]/gantt.tsx:89">
P2: `role="img"` hides the task rows and their titles from assistive tech, leaving only the summary label. Use `role="group"` so the labelled container still exposes its content.</violation>
</file>

<file name="src/db/schema.ts">

<violation number="1" location="src/db/schema.ts:399">
P2: This foreign key checks only that the company ID exists, so project create/update can associate an organization A project with organization B's company. Validate the company in the project organization before persisting it.</violation>

<violation number="2" location="src/db/schema.ts:525">
P3: `crm_companies_org_idx` duplicates the `(org_id, name)` unique constraint on the same table, so every write maintains two identical b-tree indexes. Drop the plain index; the unique constraint already covers org-scoped name ordering, as the `branches` comment in this file notes.</violation>

<violation number="3" location="src/db/schema.ts:604">
P2: `stageId` cascades on delete, so removing a stage silently deletes all of its deals and their activities. Deals are sales records, so use `restrict` to block deleting a stage that still holds deals.</violation>

<violation number="4" location="src/db/schema.ts:613">
P2: `value` is an int4 column, but `assertSafeAmount` allows values up to `Number.MAX_SAFE_INTEGER`. A deal above Rp 2.147 miliar passes validation and then fails at insert. Use a `bigint(..., { mode: "number" })` column, or cap the deal value at 2147483647 in `assertSafeAmount`. Either needs a new migration because 0007 already creates the column as `integer`.</violation>
</file>

<file name="src/lib/repos/project-repo.ts">

<violation number="1" location="src/lib/repos/project-repo.ts:48">
P3: `getProject` converts every repository error into `null`, making database outages appear as missing projects. Catch only `NotFoundError` and rethrow other errors.</violation>

<violation number="2" location="src/lib/repos/project-repo.ts:78">
P2: Concurrent project creation can calculate the same code and make one request fail on the unique constraint. Generate and insert the code under a transaction or retry the conflict.</violation>

<violation number="3" location="src/lib/repos/project-repo.ts:85">
P2: `createProject` stores `clientCompanyId` without checking that the company belongs to `orgId`. A caller can link a project to another org's company. Verify the company with an `orgId`-scoped lookup before the insert, as `createContact` and `createDeal` do with `requireOrgCompany`.</violation>
</file>

<file name="src/lib/deals/service.ts">

<violation number="1" location="src/lib/deals/service.ts:50">
P2: `closeDeal` never validates `outcome` at runtime. A value like `"open"` passes the enum check and leaves the deal in the Close Lost stage with `status='open'` and `closedAt` set. Add a guard before the update.</violation>

<violation number="2" location="src/lib/deals/service.ts:53">
P2: `closeDeal` is documented as idempotent but overwrites already-closed deals. Return the existing closed deal or restrict the update to `status = "open"` so stale requests cannot flip the outcome.</violation>

<violation number="3" location="src/lib/deals/service.ts:92">
P2: The status update is not conditioned on the status that was validated. Two concurrent transitions from `sent` can both succeed. Add `quotationStatus = deal.quotationStatus` to the WHERE clause and throw when no row is returned.</violation>
</file>

<file name="src/db/seed.ts">

<violation number="1" location="src/db/seed.ts:283">
P2: `stageRows.length !== 0` treats any nonempty stage set as complete. A partial pipeline can therefore miss a default stage and crash at `stage.name`; ensure every required stage by name before seeding deals.</violation>

<violation number="2" location="src/db/seed.ts:442">
P2: `taskTitles` is organization-wide even though tasks belong to a project. An existing same-titled task in another project makes the loop skip the PRJ-001 task, leaving the promised seed set incomplete; scope the key to `mainProject.id` and title.</violation>
</file>

<file name="src/app/(app)/proyek/page.tsx">

<violation number="1" location="src/app/(app)/proyek/page.tsx:87">
P2: Members see an editable project-status select, but the action requires admin role, so every member change fails. Hide this control for members or pass the role and render it only for admins.</violation>

<violation number="2" location="src/app/(app)/proyek/page.tsx:158">
P2: `CompaniesGate` loads the org's company list without a membership check, unlike `ProjectTable` on the same page. Add `requireOrgRole` here and pass `userId` in, so a non-member cannot read company names through this component.</violation>
</file>

<file name="src/app/(app)/crm/new-deal-dialog.tsx">

<violation number="1" location="src/app/(app)/crm/new-deal-dialog.tsx:61">
P2: Title and value are cleared on every submit, including failed ones, because the form is uncontrolled and `submit` returns synchronously. React 19 resets the form after the action completes, so a validation error such as a dotted value ("15.000.000") wipes what the user typed. Hold `title` and `value` in state, or submit from `onSubmit` with `preventDefault()`, so the inputs survive a failed save.</violation>
</file>

<file name="src/app/(app)/crm/perusahaan/dialogs.tsx">

<violation number="1" location="src/app/(app)/crm/perusahaan/dialogs.tsx:43">
P2: Failed submissions wipe the typed values. `<form action={submit}>` lets React reset the uncontrolled fields after the action, even when it fails. A duplicate company name hits `crm_companies_org_name_unique`, so the user loses their input while the dialog stays open. Submit through `onSubmit` with `e.preventDefault()` and build the data from `new FormData(e.currentTarget)`, and make the same change to the contact form.</violation>
</file>

<file name="drizzle/0007_brown_gabe_jones.sql">

<violation number="1" location="drizzle/0007_brown_gabe_jones.sql:142">
P3: `crm_companies_org_idx` duplicates the `(org_id, name)` unique index created by `crm_companies_org_name_unique`. Remove the redundant index to avoid unnecessary storage and write overhead.</violation>
</file>

<file name="src/app/(app)/proyek/timesheet/timer-banner.tsx">

<violation number="1" location="src/app/(app)/proyek/timesheet/timer-banner.tsx:10">
P2: `now` is initialised with `Date.now()` during SSR and again at hydration, so the rendered elapsed text mismatches and React logs a hydration error. Start `now` as `null`, set it in the effect, and render a placeholder until mounted.</violation>

<violation number="2" location="src/app/(app)/proyek/timesheet/timer-banner.tsx:54">
P2: When stop fails, the page is not refreshed, so the banner keeps showing a timer that no longer exists and the user can only reload. Call `router.refresh()` on the error path (add `useRouter` from `next/navigation` in `RunningTimer`).</violation>
</file>

<file name="src/components/app-shell.tsx">

<violation number="1" location="src/components/app-shell.tsx:51">
P3: These links now expose `/crm` and `/proyek`, but `NavLinks` still hard-codes Dashboard as active. On either page, Dashboard is incorrectly announced as current while the visited section has no active styling or `aria-current`; derive the active item from the current pathname.</violation>
</file>

<file name="src/lib/deals/crm.integration.test.ts">

<violation number="1" location="src/lib/deals/crm.integration.test.ts:167">
P2: The isolation checks skip the quotation-status and activity write paths. Add `deals.setQuotationStatus(ownerB.id, orgB.id, deal.id, "sent")` and `crm.createActivity(ownerB.id, orgB.id, { dealId: deal.id, ... })` expecting `NotFoundError` to cover all mutations the PR describes.</violation>
</file>

<file name="src/app/(app)/proyek/project-dialogs.tsx">

<violation number="1" location="src/app/(app)/proyek/project-dialogs.tsx:68">
P2: A failed create clears the project name the user typed, because the uncontrolled form resets after the sync form action. Handle submission with an `onSubmit` that calls `preventDefault` and passes `new FormData(e.currentTarget)` to `submit`, so the dialog keeps the input on error.</violation>

<violation number="2" location="src/app/(app)/proyek/project-dialogs.tsx:84">
P3: The client-company combobox has no accessible name. Add `aria-label="Perusahaan Klien"` to the `SelectTrigger`, or associate it with the label via `id`/`htmlFor`.</violation>
</file>

<file name="src/app/(app)/crm/deal-board.tsx">

<violation number="1" location="src/app/(app)/crm/deal-board.tsx:151">
P2: If the server action throws or the request fails, the transition rejects with no toast and no feedback. Wrap the await in try/catch and show `toast.error` in the catch branch.</violation>
</file>
```

</details>

<sub>Reply with feedback, questions, or to request a fix.<br /><br />[View guided diff](https://www.cubic.dev/pr/katsugtgz/openbizcrm/pull/5?utm_source=github&utm_medium=review_footer) | [Turn on auto-fix](https://www.cubic.dev/action/auto-fix/pr/katsugtgz/openbizcrm/5?returnTo=https%3A%2F%2Fgithub.com%2Fkatsugtgz%2Fopenbizcrm%2Fpull%2F5) | [Re-trigger cubic](https://www.cubic.dev/action/re-review/pr/katsugtgz/openbizcrm/5/ai_pr_review_github_delivery_a02fbd40ba592a2e7936efeeeadfff21b0611bdff95036693f021621323a1468?returnTo=https%3A%2F%2Fgithub.com%2Fkatsugtgz%2Fopenbizcrm%2Fpull%2F5)</sub>

<!-- cubic:review-post:ai_pr_review_github_delivery_a02fbd40ba592a2e7936efeeeadfff21b0611bdff95036693f021621323a1468:c8deeff39df6982ef9ede61c950f5ec15b1e2fc7:55da7af3-b962-5c8f-9f11-df72ff1db0c9 -->
