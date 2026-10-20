<!-- cubic:review-summary:start -->

**60 issues found** across 69 files
<!-- cubic:review-summary:end -->

<details>
<summary>Prompt for AI agents (unresolved issues)</summary>

```text

Check if these issues are valid — if so, understand the root cause of each and fix them. When an issue isn't valid or won't be fixed in this PR, reply in its thread with the reason and then resolve the thread. If appropriate, use sub-agents to investigate and fix each issue separately.


<file name="src/lib/whatsapp/worker.ts">

<violation number="1" location="src/lib/whatsapp/worker.ts:29">
P1: `drainOutbox` sends before it claims or marks a row, so a concurrent worker or a crash before `resolveOutbox` can deliver the same WhatsApp message more than once. Atomically claim rows, or use a lease or idempotency key, before invoking the sender.</violation>

<violation number="2" location="src/lib/whatsapp/worker.ts:70">
P0: The CLI starts `runWorker` without a sender, so it uses the always-success stub and marks every queued message sent without sending it. Fail closed outside development or inject a real sender before starting the worker.</violation>
</file>

<file name="src/app/(app)/penilaian/review-controls.tsx">

<violation number="1" location="src/app/(app)/penilaian/review-controls.tsx:112">
P1: `SubmitReviewForm` cannot submit forms with fields other than the three hardcoded keys. Render the assignment’s stored field definitions and build `answers` from those controls, otherwise every custom required field causes the server validation to fail.</violation>
</file>

<file name="src/lib/chat/realtime.ts">

<violation number="1" location="src/lib/chat/realtime.ts:32">
P2: Each message creates a new long-lived Ably realtime client, but this module never reuses or closes it. Cache one client per process, or use the REST publisher for one-shot publishing, to prevent connection growth under normal chat traffic.</violation>

<violation number="2" location="src/lib/chat/realtime.ts:42">
P1: This org-wide channel broadcasts direct and private group message bodies to every subscriber, bypassing the conversation-membership boundary enforced by `listMessages`. Publish on a conversation-scoped channel and enforce membership in the Ably subscriber/token authorization; client-side filtering cannot protect messages already delivered.</violation>
</file>

<file name="src/lib/review/aggregate.ts">

<violation number="1" location="src/lib/review/aggregate.ts:20">
P1: The aggregator trusts numeric keys that validation ignores, allowing a reviewer to add `fakeScore` and manipulate the stored average. Aggregate only declared numeric form fields or reject unknown answer keys.</violation>

<violation number="2" location="src/lib/review/aggregate.ts:21">
P1: `Number(value)` converts optional blank text and boolean answers into scores. This makes the default form's blank `perbaikan` count as 0 and biases every aggregate; only coerce nonblank strings or numbers, skipping `null`, booleans, and empty/whitespace strings.</violation>
</file>

<file name="src/app/(app)/penilaian/aggregate-section.tsx">

<violation number="1" location="src/app/(app)/penilaian/aggregate-section.tsx:24">
P1: This admin-only aggregate is visible to every organization member because the guard requires only `member`; require at least `admin` before loading and rendering these ratings.</violation>
</file>

<file name="src/lib/review/service.ts">

<violation number="1" location="src/lib/review/service.ts:43">
P2: Select definitions can pass validation with non-array `options`, then crash validation or public rendering. Require an array of string options before storing the form.</violation>

<violation number="2" location="src/lib/review/service.ts:156">
P2: The slug-allocation lock is organization-scoped even though `reviewForms.slug` is globally unique. Use one global slug-allocation lock, or retry the unique conflict and allocate the next suffix.</violation>

<violation number="3" location="src/lib/review/service.ts:279">
P2: The active-form check is not atomic with period creation. Lock and re-read the form in the same transaction as the insert so closing a form cannot race into an invalid open period.</violation>

<violation number="4" location="src/lib/review/service.ts:329">
P2: The open-period check occurs outside the transaction that inserts assignments. Re-read and lock the period after acquiring the advisory lock so a concurrent `closePeriod` cannot create assignments in an already-closed period.</violation>

<violation number="5" location="src/lib/review/service.ts:341">
P2: `assignReviewers` does not verify that either participant belongs to `orgId`, allowing cross-organization users to be assigned and included in review data. Validate both IDs against `orgMemberships` inside the transaction before inserting.</violation>

<violation number="6" location="src/lib/review/service.ts:430">
P1: The public endpoint can attach a response to an assignment belonging to a different form in the same organization. Require the assignment’s period to reference `form.id` before validating or inserting the response.</violation>

<violation number="7" location="src/lib/review/service.ts:487">
P2: Public submissions can race period closure because they do not use the review advisory lock. Acquire the organization lock before checking the period and inserting the response.</violation>
</file>

<file name="src/app/(app)/penilaian/page.tsx">

<violation number="1" location="src/app/(app)/penilaian/page.tsx:132">
P1: The only open-period control rendered here closes the period; no UI invokes `assignReviewersAction`, so newly created periods have no assignments and reviewers cannot submit. Add an assignment control for open periods.</violation>
</file>

<file name="src/lib/ai/conversation.ts">

<violation number="1" location="src/lib/ai/conversation.ts:47">
P1: `appendMessage` ignores `orgId`, so any caller with another organization's conversation ID can inject a message into that conversation and its AI history. Check the conversation's organization through `exec` before inserting, as `listMessages` does.</violation>
</file>

<file name="src/app/(app)/obrolan/chat-room.tsx">

<violation number="1" location="src/app/(app)/obrolan/chat-room.tsx:37">
P2: The form clears the message before the server action succeeds, so any rejected send only shows a toast and silently discards the user’s text. Keep the form value until `result.ok` and reset it only after a successful send.</violation>

<violation number="2" location="src/app/(app)/obrolan/chat-room.tsx:50">
P1: This room has no inbound refresh or realtime subscription, so messages from other participants remain invisible until the user navigates or manually refreshes the page. Subscribe to the org/conversation channel when realtime is configured, or add a polling/refresh fallback.</violation>
</file>

<file name="drizzle/0022_smooth_bloodstrike.sql">

<violation number="1" location="drizzle/0022_smooth_bloodstrike.sql:101">
P1: An authenticated organization member can submit an assignment for users who are not members of that organization because these foreign keys do not require an `org_memberships(org_id, user_id)` row. Add composite membership foreign keys for both reviewer and reviewee, or validate both memberships before inserting.</violation>
</file>

<file name="src/lib/drive/service.ts">

<violation number="1" location="src/lib/drive/service.ts:67">
P2: This configuration hard-codes the Cloudflare R2 endpoint, so the documented MinIO development backend cannot use the drive service. Read a configurable S3 endpoint or route through the storage adapter, selecting the R2 endpoint only for R2 deployments.</violation>

<violation number="2" location="src/lib/drive/service.ts:164">
P1: Presign inserts a quota-sized row before the PUT, with no expiry or cleanup for unconfirmed uploads. Failed or abandoned uploads remain listed and consume quota until manual deletion, so any member can reserve 10 GB and block the organization. Track pending reservations with expiry and cleanup, or count only confirmed uploads.</violation>

<violation number="3" location="src/lib/drive/service.ts:203">
P1: `confirmUpload` only checks that the object exists; it never compares `HeadObject.ContentLength` with `file.sizeBytes`. A client can therefore confirm a differently sized object, making the 10 GB quota and displayed usage disagree. Compare the HEAD size and remove or reject mismatched objects before confirming them.</violation>

<violation number="4" location="src/lib/drive/service.ts:367">
P2: `deleteFile` removes the database row before deleting the R2 object. A transient R2 failure therefore leaves an unrecoverable orphan that consumes storage outside quota accounting. Keep a durable deletion record or outbox and retry object deletion before losing the key.</violation>
</file>

<file name="src/lib/whatsapp/service.ts">

<violation number="1" location="src/lib/whatsapp/service.ts:78">
P2: The initialization path can report `NotFoundError` when `enqueueWhatsappMessage` concurrently creates the lazy session, because the conflict path does not re-read the existing row. Re-select the session after the conflict, as `requireSession` already does.</violation>

<violation number="2" location="src/lib/whatsapp/service.ts:122">
P1: `enqueueWhatsappMessage` checks the session before acquiring the org lock. A concurrent disconnect can commit before the insert, so messages are queued while the session is disconnected; re-read and validate the session inside the locked transaction.</violation>
</file>

<file name="src/app/(app)/pelatihan/course-dialog.tsx">

<violation number="1" location="src/app/(app)/pelatihan/course-dialog.tsx:97">
P2: `AddMaterialButton` is never rendered, so the training UI provides no way to add material after course creation. Render this component from each course card (and expose the materials if they should be viewable).</violation>
</file>

<file name="src/app/(app)/obrolan/new-chat-dialogs.tsx">

<violation number="1" location="src/app/(app)/obrolan/new-chat-dialogs.tsx:54">
P2: This success path only refreshes the current URL, so “Buka Chat” can close the dialog while leaving the user in the previously selected conversation, especially when an existing `?c` is present. Return the opened conversation ID from the action and push `/obrolan?c=${result.conversationId}` instead of only refreshing.</violation>
</file>

<file name="src/lib/chat/service.ts">

<violation number="1" location="src/lib/chat/service.ts:115">
P2: `openDirect` can create duplicate 1:1 conversations under concurrent requests because both calls perform the lookup before either transaction inserts. Serialize and recheck inside one transaction, or enforce a pair-level unique key.</violation>

<violation number="2" location="src/lib/chat/service.ts:270">
P2: After a conversation exceeds 50 messages, this ascending query returns only the earliest 50, so the chat page never shows newer messages, including a just-sent message. Fetch the newest window and reverse it before returning, or add pagination.</violation>
</file>

<file name="src/lib/ai/tools.ts">

<violation number="1" location="src/lib/ai/tools.ts:46">
P2: `fetchThisMonthSummary` targets an endpoint that does not exist, so every invocation fails with HTTP 404. Use `computeThisMonthSummary` or add the corresponding route before exposing this helper.</violation>

<violation number="2" location="src/lib/ai/tools.ts:68">
P2: This starts the WIB month seven hours late, so the AI summary omits records created during the first seven hours of every month. Construct the boundary at `00:00+07:00` (and use the same timezone convention for all queried tables).</violation>

<violation number="3" location="src/lib/ai/tools.ts:84">
P2: `invoicesUnpaid` currently counts draft and cancelled invoices as unpaid, distorting the monthly KPI. Count only outstanding statuses such as `sent` and `overdue`.</violation>

<violation number="4" location="src/lib/ai/tools.ts:91">
P2: These queries have no exclusive next-month bound, so future-dated rows are reported as activity for the current month. Add a next-month upper bound to each aggregate query.</violation>
</file>

<file name="src/app/(app)/laporan/page.tsx">

<violation number="1" location="src/app/(app)/laporan/page.tsx:46">
P2: This catch turns accounting query failures into a plausible-looking dash, so users cannot distinguish an outage from missing revenue. Preserve the error or expose an explicit unavailable state instead of swallowing every failure.</violation>

<violation number="2" location="src/app/(app)/laporan/page.tsx:59">
P2: The card counts `absent` and `leave` records as present. Filter to `ontime`, `late`, and `wfh` before displaying the “karyawan tercatat hadir” KPI.</violation>

<violation number="3" location="src/app/(app)/laporan/page.tsx:77">
P2: `completions.length` counts completion records across all users, but the card presents the result against the number of courses. Count distinct courses or relabel the metric as total completions so the KPI denominator remains meaningful.</violation>
</file>

<file name="src/db/schema.ts">

<violation number="1" location="src/db/schema.ts:1198">
P1: These single-column foreign keys do not enforce that each child belongs to the same organization as its parent. Add tenant-aware composite foreign keys (with `(org_id, id)` parent keys) for the new org-scoped relationships; application-side checks alone leave the database able to store rows that can be exposed or cascaded under the wrong tenant.</violation>
</file>

<file name="src/app/(app)/pelatihan/page.tsx">

<violation number="1" location="src/app/(app)/pelatihan/page.tsx:53">
P2: This page never loads or renders course materials, making the material entered during course creation—and the seeded onboarding module—inaccessible to learners. Fetch and display `listMaterials` for each course before offering the completion control.</violation>
</file>

<file name="src/app/(app)/cloud/actions.ts">

<violation number="1" location="src/app/(app)/cloud/actions.ts:59">
P2: This invalidates the cloud page before the browser PUT succeeds, so a failed upload leaves a visible `drive_files` row consuming quota; defer visibility and usage until confirmation or add cleanup.</violation>
</file>

<file name="src/lib/review/validate.ts">

<violation number="1" location="src/lib/review/validate.ts:12">
P2: A form field named `__proto__` bypasses validation because assignments to this normal error object invoke the prototype setter instead of creating an error entry. Use a null-prototype error map and own-property lookup, or reject reserved keys when defining fields.</violation>

<violation number="2" location="src/lib/review/validate.ts:37">
P2: This coercion accepts booleans and arrays as numeric answers; for example, `true` becomes score `1`. Restrict the fallback conversion to strings, or reject non-number values before coercion.</violation>
</file>

<file name="src/app/(app)/formulir/page.tsx">

<violation number="1" location="src/app/(app)/formulir/page.tsx:66">
P2: This displayed public link cannot submit a review because `/r/[slug]` requires `?a=<assignmentId>`. Generate reviewer-specific tokenized URLs here, or label this link as preview and expose the tokenized links separately.</violation>
</file>

<file name="src/lib/chat/chat-drive.integration.test.ts">

<violation number="1" location="src/lib/chat/chat-drive.integration.test.ts:96">
P2: This assertion makes the integration suite environment-dependent: with valid R2 credentials, `presignUpload` succeeds and the folder isolation test never runs. Guard the configuration-specific assertion or provide a storage test double instead of requiring R2 to be absent.</violation>

<violation number="2" location="src/lib/chat/chat-drive.integration.test.ts:102">
P2: This test does not verify quota rejection in the default DB-test environment; it passes because `ConfigError` occurs before the quota query. Assert the specific quota error with a configured storage double, or move this case to a test that can exercise the quota transaction.</violation>
</file>

<file name="src/app/r/[slug]/public-submit.tsx">

<violation number="1" location="src/app/r/[slug]/public-submit.tsx:37">
P2: Blank optional number fields are converted to `0`, so they are either persisted as an answer or rejected by `min` validation instead of remaining empty. Preserve the empty string before calling `Number`.</violation>

<violation number="2" location="src/app/r/[slug]/public-submit.tsx:69">
P2: Required checkboxes lack native required validation even though the UI marks them with an asterisk. Add `required={f.required}` so browsers and assistive technology enforce the same requirement as the other field types.</violation>
</file>

<file name="src/app/(app)/obrolan/page.tsx">

<violation number="1" location="src/app/(app)/obrolan/page.tsx:82">
P2: Every direct conversation has a null `name`, so this renders all direct chats as `Percakapan langsung` and users cannot distinguish multiple 1:1 chats. Include the other member's name in the conversation projection and render it here.</violation>
</file>

<file name="src/app/(app)/cloud/cloud-browser.tsx">

<violation number="1" location="src/app/(app)/cloud/cloud-browser.tsx:155">
P2: The `Folder induk` link always returns to the root, so navigating up from a nested folder skips its immediate parent. Pass the current folder's parent ID into this component and link to `/cloud?f=<parentId>`, omitting `f` only for the root.</violation>
</file>

<file name="src/lib/review/service.integration.test.ts">

<violation number="1" location="src/lib/review/service.integration.test.ts:94">
P2: This cleanup leaks every test user whenever the suite creates an organization, because organization deletion does not cascade to `users` and the second branch is skipped. Delete the tracked users unconditionally after deleting the organizations.</violation>
</file>

<file name="src/app/api/ai/chat/route.ts">

<violation number="1" location="src/app/api/ai/chat/route.ts:37">
P2: `message` is persisted and sent to the AI provider without a size limit. Reject messages above an explicit maximum before `createConversation` to prevent database and provider-cost abuse.</violation>

<violation number="2" location="src/app/api/ai/chat/route.ts:57">
P2: This route creates a fresh conversation for every POST, so subsequent user turns can never load the previous history and the persisted AI chat behaves as isolated one-turn exchanges. Accept and authorize an existing `conversationId`, creating a conversation only when starting a new chat.</violation>
</file>

<file name="src/components/app-shell.tsx">

<violation number="1" location="src/components/app-shell.tsx:66">
P2: The expanded navigation overflows the mobile sheet, leaving the lower links unreachable on phone-height viewports because `SheetContent` is fixed to `h-full` without scrolling. Add `overflow-y-auto` to the mobile sheet (and the desktop sidebar if needed) so every new destination remains accessible.</violation>
</file>

<file name="src/app/(app)/lms/page.tsx">

<violation number="1" location="src/app/(app)/lms/page.tsx:5">
P2: The LMS never loads or renders course materials, so content created in `NewCourseDialog` is inaccessible to learners. Load `listMaterials` and render each course’s material content.</violation>

<violation number="2" location="src/app/(app)/lms/page.tsx:56">
P2: `CompleteCourseButton` completes the course but only revalidates `/pelatihan`, so `/lms` continues showing “Tandai Selesai” after success until the user navigates or manually refreshes. Revalidate `/lms` too, or refresh/update the button state after completion.</violation>
</file>

<file name="src/db/seed.ts">

<violation number="1" location="src/db/seed.ts:844">
P2: `selfAssignment` filters only by period and reviewer, so an existing member assignment for another reviewee can receive the seeded self-review answers and be marked submitted. Also filter by the seeded member as `revieweeUserId` (and preferably `relation: "self"`).</violation>
</file>

<file name="src/lib/review/aggregate.test.ts">

<violation number="1" location="src/lib/review/aggregate.test.ts:31">
P2: This “no score” test does not cover the missing numeric answers that production can submit. Add an empty optional number (and ideally checkbox/non-numeric JSON values) to ensure they are not coerced into score `0` or `1`; otherwise the suite passes while incomplete responses affect the 360 average.</violation>
</file>

<file name="src/__tests__/ui-smoke.test.tsx">

<violation number="1" location="src/__tests__/ui-smoke.test.tsx:55">
P2: This test still checks only 10 of the 19 navigation items, so changing the title to “all nav items” gives false coverage: the omitted collaboration and business links can regress without failing the smoke test. Add every `NAV_ITEMS` label to the assertions, or describe this as a selected-nav-items test instead.</violation>
</file>

<file name="src/app/(app)/cloud/page.tsx">

<violation number="1" location="src/app/(app)/cloud/page.tsx:10">
P2: The quota display uses decimal units while the service enforces a binary 10 GiB quota, so a full permitted drive appears to exceed its displayed limit. Use the same 1024-based units for this formatter or display the enforced quota with the matching value.</violation>
</file>

<file name="src/app/(app)/penilaian/actions.ts">

<violation number="1" location="src/app/(app)/penilaian/actions.ts:50">
P2: `parseFieldsJson` silently drops malformed entries and accepts fields without the required `label`, so a malformed payload can save a form missing questions or render `undefined` labels. Reject the entire definition when any item fails the runtime shape check.</violation>
</file>
```

</details>

<sub>Reply with feedback, questions, or to request a fix.<br /><br />[View guided diff](https://www.cubic.dev/pr/katsugtgz/openbizcrm/pull/9?utm_source=github&utm_medium=review_footer) | [Turn on auto-fix](https://www.cubic.dev/action/auto-fix/pr/katsugtgz/openbizcrm/9?returnTo=https%3A%2F%2Fgithub.com%2Fkatsugtgz%2Fopenbizcrm%2Fpull%2F9) | [Re-trigger cubic](https://www.cubic.dev/action/re-review/pr/katsugtgz/openbizcrm/9/ai_pr_review_github_delivery_6815dd6708d65440717ab7e6259864a575ef9fe1c1829cbbd25454f53a8cc81d?returnTo=https%3A%2F%2Fgithub.com%2Fkatsugtgz%2Fopenbizcrm%2Fpull%2F9)</sub>

<!-- cubic:review-post:ai_pr_review_github_delivery_6815dd6708d65440717ab7e6259864a575ef9fe1c1829cbbd25454f53a8cc81d:7742ee607fd876f9b3b66ffc7be597c1934a060c:13ebc298-961a-5922-a641-1973dd5f55ce -->

## Resolution status

Verified 2026-10-20 on `feat/collaboration` @ e42f536 + working tree. **60/60 FIXED.** Gates: lint, tsc, `env -u DATABASE_URL bun run build`, `RUN_DB_TESTS=1 bun run test:coverage` (41 files / 343 tests green), `bun run db:generate` clean (no schema drift; migrations 0023–0028 present, incl. tenant composite FKs and assignment membership FKs).

| #          | File:line (cubic)                     | Severity    | Status                                                                                                                        |
| ---------- | ------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| wa-1       | whatsapp/worker.ts:29                 | P1          | FIXED — `claimOutbox` flips `queued`→`sending` atomically before send; concurrent worker/crash cannot double-send.            |
| wa-2       | whatsapp/worker.ts:70                 | P0          | FIXED — guarded main fail-closed when `NODE_ENV !== "development"` without a real sender.                                     |
| rev-ui-1   | review-controls.tsx:112               | P1          | FIXED — `SubmitReviewForm` renders stored field defs, builds `answers` per type.                                              |
| rt-1       | chat/realtime.ts:32                   | P2          | FIXED (this pass) — one `Ably.Rest` cached per process (`cachedClient`).                                                      |
| rt-2       | chat/realtime.ts:42                   | P1          | FIXED — conversation-scoped channel `chat:conv:<id>`; membership enforced at token authorization.                             |
| agg-1      | review/aggregate.ts:20                | P1          | FIXED — `numericKeys` allowlist; unknown keys (`fakeScore`) ignored; closePeriod now derives it from form fields (this pass). |
| agg-2      | review/aggregate.ts:21                | P1          | FIXED — `toScore` accepts number / nonblank numeric string only; null/bool/blank skipped.                                     |
| agg-ui-1   | aggregate-section.tsx:24              | P1          | FIXED — `requireOrgRole(userId, orgId, "admin")` guard.                                                                       |
| svc-1      | review/service.ts:43                  | P2          | FIXED — `validateFieldDefs` requires string-array `options` for select.                                                       |
| svc-2      | review/service.ts:156                 | P2          | FIXED — global `review:slug` lock + suffix allocation in-tx.                                                                  |
| svc-3      | review/service.ts:279                 | P2          | FIXED — form locked/re-read inside period-create tx under `review:<orgId>`.                                                   |
| svc-4      | review/service.ts:329                 | P2          | FIXED — period re-read `for update` inside assign tx under org lock.                                                          |
| svc-5      | review/service.ts:341                 | P2          | FIXED — both participants validated against `orgMemberships` in-tx; DB FKs too (0028).                                        |
| svc-6      | review/service.ts:430                 | P1          | FIXED — public submit: `period.formId !== form.id` rejected; period re-read locked.                                           |
| svc-7      | review/service.ts:487                 | P2          | FIXED — public submit acquires `review:<orgId>` lock before period check + insert.                                            |
| pen-1      | penilaian/page.tsx:132                | P1          | FIXED — `AssignReviewersDialog` rendered for open periods (admin).                                                            |
| ai-1       | ai/conversation.ts:47                 | P1          | FIXED — `appendMessage` checks conversation org via `exec` before insert.                                                     |
| chat-1     | obrolan/chat-room.tsx:37              | P2          | FIXED — `form.reset()` only after `result.ok`.                                                                                |
| chat-2     | obrolan/chat-room.tsx:50              | P1          | FIXED — 5s focused `router.refresh()` polling fallback.                                                                       |
| mig-1      | 0022_smooth_bloodstrike.sql:101       | P1          | FIXED — composite membership FKs on `review_assignments` (0028) + in-service validation.                                      |
| dr-1       | drive/service.ts:67                   | P2          | FIXED — `S3_ENDPOINT` override for MinIO; R2 default only.                                                                    |
| dr-2       | drive/service.ts:164                  | P1          | FIXED — pending rows with `expiresAt`, `purgeExpiredPending` on next presign.                                                 |
| dr-3       | drive/service.ts:203                  | P1          | FIXED — HEAD `ContentLength` compared to reservation; mismatch deletes object + row.                                          |
| dr-4       | drive/service.ts:367                  | P2          | FIXED — R2 delete after commit; failure recorded as `drive.file.delete.object.failed` audit with key for retry.               |
| wasvc-1    | whatsapp/service.ts:78                | P2          | FIXED — conflict path re-reads existing session row.                                                                          |
| wasvc-2    | whatsapp/service.ts:122               | P1          | FIXED — session locked/re-validated inside `wa:<orgId>` tx before enqueue.                                                    |
| pel-1      | pelatihan/course-dialog.tsx:97        | P2          | FIXED — `AddMaterialButton` rendered per course card.                                                                         |
| dlg-1      | obrolan/new-chat-dialogs.tsx:54       | P2          | FIXED — actions return `conversationId`; dialogs push `/obrolan?c=<id>`.                                                      |
| chat-svc-1 | chat/service.ts:115                   | P2          | FIXED — serialize + recheck inside one tx under `chat:<orgId>`.                                                               |
| chat-svc-2 | chat/service.ts:270                   | P2          | FIXED — newest window (desc, limit) reversed to chronological.                                                                |
| ai-2       | ai/tools.ts:46                        | P2          | FIXED — direct DB aggregation (`computeThisMonthSummary`), no HTTP fetch.                                                     |
| ai-3       | ai/tools.ts:68                        | P2          | FIXED — WIB boundaries `00:00:00.000+07:00`.                                                                                  |
| ai-4       | ai/tools.ts:84                        | P2          | FIXED — unpaid counts `sent`/`overdue` only.                                                                                  |
| ai-5       | ai/tools.ts:91                        | P2          | FIXED — exclusive next-month upper bound on all aggregates.                                                                   |
| lap-1      | laporan/page.tsx:46                   | P2          | FIXED — accounting failure surfaces explicit "error" state, not zero-like dash.                                               |
| lap-2      | laporan/page.tsx:59                   | P2          | FIXED — presence counts `ontime`/`late`/`wfh` only.                                                                           |
| lap-3      | laporan/page.tsx:77                   | P2          | FIXED — `selectDistinct` courseId; KPI = courses covered.                                                                     |
| sch-1      | db/schema.ts:1198                     | P1          | FIXED — tenant composite FKs across new tables (0025/0026/0027) + membership FKs (0028).                                      |
| pel-2      | pelatihan/page.tsx:53                 | P2          | FIXED — `listMaterials` loaded/rendered per course.                                                                           |
| cl-1       | cloud/actions.ts:59                   | P2          | FIXED — no revalidate on presign; only after confirmUpload.                                                                   |
| val-1      | review/validate.ts:12                 | P2          | FIXED — null-prototype error map (`Object.create(null)`); reserved-key test.                                                  |
| val-2      | review/validate.ts:37                 | P2          | FIXED — number coercion restricted to number/string.                                                                          |
| form-1     | formulir/page.tsx:66                  | P2          | FIXED — link labeled preview with explanation; tokenized links from Penilaian.                                                |
| it-1       | chat-drive.integration.test.ts:96     | P2          | FIXED — R2-credential-conditional assertion.                                                                                  |
| it-2       | chat-drive.integration.test.ts:102    | P2          | FIXED — quota rejection asserted only with R2 config; DB-side usage proven by injected row.                                   |
| ps-1       | r/[slug]/public-submit.tsx:37         | P2          | FIXED — blank optional number stays empty, no `Number("")`.                                                                   |
| ps-2       | r/[slug]/public-submit.tsx:69         | P2          | FIXED — `required={f.required}` on checkboxes.                                                                                |
| obl-1      | obrolan/page.tsx:82                   | P2          | FIXED — direct chats labeled with counterpart name.                                                                           |
| cld-1      | cloud-browser.tsx:155                 | P2          | FIXED — `parentFolderId` prop; back link targets immediate parent.                                                            |
| it-3       | review/service.integration.test.ts:94 | P2          | FIXED — tracked users deleted unconditionally after orgs.                                                                     |
| ai-route-1 | api/ai/chat/route.ts:37               | P2          | FIXED — 4000-char max, 413 on overflow.                                                                                       |
| ai-route-2 | api/ai/chat/route.ts:57               | P2          | FIXED — accepts authorized `conversationId`; creates only when starting.                                                      |
| shell-1    | app-shell.tsx:66                      | P2          | FIXED — `overflow-y-auto` on mobile sheet + desktop sidebar.                                                                  |
| lms-1      | lms/page.tsx:5                        | P2          | FIXED — materials loaded/rendered.                                                                                            |
| lms-2      | lms/page.tsx:56                       | P2          | FIXED — `completeCourseAction` revalidates `/pelatihan` and `/lms`.                                                           |
| seed-1     | db/seed.ts:844                        | P2          | FIXED — self-assignment filter includes `revieweeUserId` + `relation: "self"`.                                                |
| aggt-1     | review/aggregate.test.ts:31           | P2          | FIXED — covers empty optional number, checkbox/bool, null non-coercion.                                                       |
| smoke-1    | ui-smoke.test.tsx:55                  | P2          | FIXED — asserts every `NAV_ITEMS` label.                                                                                      |
| cld-2      | cloud/page.tsx:10                     | P2          | FIXED — 1024-based formatter (KiB/MiB/GiB) matching 10 GiB quota.                                                             |
| pen-2      | penilaian/actions.ts:50               | P2          | FIXED — `parseFieldsJson` rejects whole definition on any malformed item.                                                     |
| extra      | review/service.ts (closePeriod)       | P1-adjacent | FIXED (this pass) — stored results aggregate only declared number-field keys.                                                 |
