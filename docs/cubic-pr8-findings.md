<!-- cubic:review-summary:start -->

**60 issues found** across 53 files
<!-- cubic:review-summary:end -->

## Resolution — UI + test-cleanliness slice (2026-10-20)

| Finding                                                         | Status | Fix                                                                                            |
| --------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| akuntansi/page.tsx:47 Ekuitas + Laba omits profit               | fixed  | KPI now `pick("equity") + laba`, shared with Laba Bersih card.                                 |
| faktur/page.tsx:54 unbounded invoice fetch                      | fixed  | `listInvoices(orgId, limit = 100)`; card copy states "100 terbaru".                            |
| add-asset-dialog.tsx:98 state persists on cancel                | fixed  | `handleOpenChange` resets both account selections on close.                                    |
| add-asset-dialog.tsx:100 admin control rendered to members      | fixed  | New `isAdmin` prop; trigger hidden for non-admins (`hasRole(role, "admin")` in aset/page.tsx). |
| new-entry-dialog.tsx:60 "Seimbang" with missing accounts        | fixed  | `missingAccount` check gates `balanced`; error "Pilih akun untuk setiap baris."                |
| jurnal/page.tsx:54 loads every journal line                     | fixed  | Lines filtered via `inArray(entryId, page entry ids)`.                                         |
| jurnal/page.tsx:98 raw account UUIDs                            | fixed  | Lines joined to `listAccounts` map → `code name`.                                              |
| pos/service.integration.test.ts:116 serial race case            | fixed  | `Promise.allSettled` two checkouts over stock 1; exactly one succeeds, stock reaches 0.        |
| pos/service.integration.test.ts:167 org-B omits balanced        | fixed  | `expect(tbB.balanced).toBe(true)` added.                                                       |
| budget/service.integration.test.ts:82 admin-only untested       | fixed  | Creates real `member` membership; asserts `setBudget` rejects with INSUFFICIENT_ROLE.          |
| assets/service.integration.test.ts:89 one-sided org isolation   | fixed  | Complementary case: org-A expense + org-B accum account rejected.                              |
| assets/service.integration.test.ts:94 invalid inputs untested   | fixed  | Separate `salvageValue > cost` and `usefulLifeMonths: 0` cases.                                |
| close-period-dialog.tsx:42 rendered to members                  | fixed  | `ClosePeriodGate` in jurnal/page.tsx: `hasRole(role, "admin")` or `null`.                      |
| faktur/actions.ts:60 lexical date compare                       | fixed  | `normalizeDate` validates `YYYY-MM-DD` at the boundary for issueDate/dueDate.                  |
| buku-besar/page.tsx:79 per-line rows mislabeled as transactions | fixed  | Aggregates per entry (Map by entry id), deterministic running balance per entry.               |
| engine.test.ts:35 `/50/` matches "150"                          | fixed  | Asserts `selisih 50)`.                                                                         |
| engine.test.ts:41 zero-line fixture already unbalanced          | fixed  | Added matching debit 100 CASH line; asserts exactly the zero-side error.                       |
| engine.test.ts:78 overflow test passes on per-line bound        | fixed  | Per-line-valid MAX + 100 accumulation; asserts `overflow`.                                     |

Non-DB suite 227 passed; DB suites (accounting/invoicing 42, pos/budget/assets 16) passed on seeded dev PG. `tsc`, `eslint`, `next build` clean.

Other 42 findings (service/DB/schema) are outside this slice; see their own resolution passes.

<details>
<summary>Prompt for AI agents (unresolved issues)</summary>

```text

Check if these issues are valid — if so, understand the root cause of each and fix them. When an issue isn't valid or won't be fixed in this PR, reply in its thread with the reason and then resolve the thread. If appropriate, use sub-agents to investigate and fix each issue separately.


<file name="src/lib/assets/service.ts">

<violation number="1" location="src/lib/assets/service.ts:73">
P1: The service validates account ownership but not account type, so client-supplied IDs can misclassify depreciation postings. Load the accounts and require an expense account, an asset account, and distinct IDs on the server.</violation>

<violation number="2" location="src/lib/assets/service.ts:122">
P2: The period check accepts invalid months, causing silent no-ops for `MM=00` and database errors for `MM>12`. Restrict the month to `01`–`12` in both the server validation and the form pattern.</violation>

<violation number="3" location="src/lib/assets/service.ts:125">
P0: The asset snapshot is read before the advisory lock, so concurrent runs can post duplicate depreciation journals from stale state; the failed expected-state update is ignored. Read and lock the active assets inside the transaction, and handle a zero-row update before creating the journal.</violation>

<violation number="4" location="src/lib/assets/service.ts:125">
P1: The asset snapshot is taken before the advisory lock, so concurrent runs can both post the same month; the second update affects zero rows but the code still increments `processed` and keeps its journal. Load or lock each asset inside the transaction, and only count it after a successful update.</violation>

<violation number="5" location="src/lib/assets/service.ts:154">
P1: A positive depreciable base smaller than the useful life produces a zero monthly amount and is skipped forever, so the asset is never fully depreciated. Reject that combination or carry the rounding remainder across months instead of treating it as skippable.</violation>

<violation number="6" location="src/lib/assets/service.ts:165">
P2: Flooring every monthly installment leaves a remainder beyond the declared useful life for non-divisible bases. Post the rounding remainder in the final useful-life month rather than waiting for an extra month.</violation>

<violation number="7" location="src/lib/assets/service.ts:173">
P2: Depreciation journals are always dated on the 28th rather than the actual last day of `periodEnd`. Compute the last calendar day of the requested month so the journal date matches the documented period-end behavior.</violation>

<violation number="8" location="src/lib/assets/service.ts:187">
P1: Directly marking depreciation posted bypasses the fiscal-period close guard in `postEntry`, allowing depreciation to be added to a closed month. Check the period inside this transaction before inserting, or route posting through the same guard.</violation>

<violation number="9" location="src/lib/assets/service.ts:216">
P2: Full depreciation is being recorded as disposal, so fully depreciated assets without a disposal date are mislabeled and cannot later enter the disposal workflow. Keep depreciation completion separate from physical disposal, or add an explicit fully-depreciated state.</violation>

<violation number="10" location="src/lib/assets/service.ts:222">
P1: A disposal racing with depreciation can be overwritten back to active because the expected-state predicate ignores status. Serialize disposal with the depreciation lock and revalidate the asset before posting and updating it.</violation>
</file>

<file name="src/lib/pos/service.ts">

<violation number="1" location="src/lib/pos/service.ts:57">
P1: Each checkout holds a transaction connection while `recordAudit` requests another connection from the global pool. Five concurrent checkouts can exhaust the five-connection pool and wait indefinitely for audit connections; make audit insertion use the active transaction or perform it after commit.</violation>

<violation number="2" location="src/lib/pos/service.ts:96">
P2: Restock and checkout change `products.stockQty` without recording `inventory_movements`, leaving the stock card permanently out of sync. Insert the corresponding `restock`/`sale` movement atomically with each stock update.</violation>

<violation number="3" location="src/lib/pos/service.ts:164">
P2: POS does not share the journal-number lock used by accounting and invoicing, so concurrent posting can allocate the same `entryNumber` and fail on the unique constraint. Use the common `acct:${orgId}` advisory key for this transaction (or explicitly coordinate both locks).</violation>

<violation number="4" location="src/lib/pos/service.ts:252">
P1: Checkout can post into a closed fiscal month because it inserts the POS journal directly as `posted` without checking `fiscal_periods`. Add the same transaction-scoped period-open assertion used by accounting and invoicing before creating this journal.</violation>
</file>

<file name="src/lib/accounting/service.ts">

<violation number="1" location="src/lib/accounting/service.ts:183">
P1: These audit calls use the global pool before the accounting transaction commits, so concurrent creates or posts can exhaust the five-connection pool and deadlock all requests. Make audit writes transaction-aware and execute them through `tx` (including the membership check).</violation>

<violation number="2" location="src/lib/accounting/service.ts:369">
P2: The period guard accepts impossible months and lets them fail as raw database errors. Restrict the month to `01` through `12` before executing the close transaction.</violation>

<violation number="3" location="src/lib/accounting/service.ts:444">
P2: A concurrent posting can produce a self-inconsistent balance sheet because its components come from different snapshots. Compute all report components from one transaction or repeatable-read snapshot.</violation>
</file>

<file name="src/lib/invoicing/service.ts">

<violation number="1" location="src/lib/invoicing/service.ts:148">
P2: `postJournal` bypasses the accounting line cap, allowing large invoices to post journal lines above `MAX_LINE_AMOUNT`. Validate the generated lines or reject totals above the cap before inserting them.</violation>

<violation number="2" location="src/lib/invoicing/service.ts:271">
P1: These audit calls use a second pooled connection while the invoice transaction is still open, which can exhaust the pool under concurrency and leaves audit rows non-atomic. Make audit writes transaction-aware or perform them after committing.</violation>

<violation number="3" location="src/lib/invoicing/service.ts:294">
P1: Invoice and POS postings use different advisory locks while allocating the same journal number, so concurrent checkout and invoice posting can collide. Use one shared journal-number lock or a database sequence for every journal writer.</violation>

<violation number="4" location="src/lib/invoicing/service.ts:312">
P1: Invoice posting records PPN as Revenue, overstating sales and omitting the tax liability. Credit Revenue by `invoice.subtotal` and credit a PPN-liability account by `invoice.taxAmount`.</violation>

<violation number="5" location="src/lib/invoicing/service.ts:312">
P1: Taxed invoices credit the entire gross total to Revenue, so PPN is recognized as revenue rather than a tax liability. Credit Revenue by `invoice.subtotal` and credit a dedicated PPN payable account by `invoice.taxAmount`.</violation>

<violation number="6" location="src/lib/invoicing/service.ts:446">
P2: `markOverdue` allows future-due invoices to become overdue because the update never checks `dueDate`. Require `dueDate <= CURRENT_DATE` before applying the transition.</violation>
</file>

<file name="src/db/schema.ts">

<violation number="1" location="src/db/schema.ts:761">
P2: POS stock changes never populate `inventoryMovements`, so the new stock-card table stays empty. Insert a sale or restock movement in the same transaction as each `stockQty` change.</violation>

<violation number="2" location="src/db/schema.ts:813">
P1: `journalLines` does not enforce that its entry and account belong to the same organization as the line. Add composite tenant-aware foreign keys (and matching parent keys) so accounting data cannot be cross-linked across organizations.</violation>

<violation number="3" location="src/db/schema.ts:826">
P2: The `bigint` columns no longer enforce the engine’s 2^31−1 journal-line cap, allowing invoice and POS postings above that limit. Add an upper-bound CHECK or keep these columns `integer` so every journal writer shares the same constraint.</violation>

<violation number="4" location="src/db/schema.ts:826">
P2: The journal-line check still accepts `(debit, credit) = (0, 0)`, creating invalid non-postable lines outside the service validator. Require exactly one positive side in both the schema and migration.</violation>

<violation number="5" location="src/db/schema.ts:902">
P2: These journal links are unconstrained UUIDs, so invoices, payments, and POS sales can retain dangling or cross-organization journal references. Add foreign keys with the intended deletion policy in the schema and migration.</violation>
</file>

<file name="src/app/(app)/akuntansi/laporan/page.tsx">

<violation number="1" location="src/app/(app)/akuntansi/laporan/page.tsx:67">
P2: This render scans the full posted ledger three times because `balanceSheet` recomputes `incomeStatement` after the page already requested it. Use a combined report service or share one trial-balance snapshot to avoid the repeated database and memory work.</violation>

<violation number="2" location="src/app/(app)/akuntansi/laporan/page.tsx:67">
P2: The report page performs three full trial-balance scans for two panels because `balanceSheet` recomputes income internally. Use one combined report query or share a single trial-balance snapshot to avoid duplicate database work.</violation>

<violation number="3" location="src/app/(app)/akuntansi/laporan/page.tsx:68">
P1: The Laba Rugi report includes every posted journal, despite being labeled “periode berjalan.” Add a period/as-of filter to the report queries, or change the UI to explicitly describe the values as cumulative.</violation>
</file>

<file name="src/lib/accounting/engine.ts">

<violation number="1" location="src/lib/accounting/engine.ts:49">
P2: `MAX_LINE_AMOUNT` still enforces the old PostgreSQL `integer` limit, so journal amounts above Rp2,147,483,647 are rejected despite `journal_lines` now being `bigint`. Use the JavaScript safe bound or document and enforce this as a separate business limit.</violation>

<violation number="2" location="src/lib/accounting/engine.ts:114">
P2: The balance helpers aggregate unbounded amounts with `number`, so cumulative postings can round past `Number.MAX_SAFE_INTEGER` and make balances or `balanced` incorrect. Accumulate with `BigInt` or reject an addition before it becomes unsafe.</violation>

<violation number="3" location="src/lib/accounting/engine.ts:134">
P2: `trialBalance` can report an unbalanced ledger as balanced after aggregate totals exceed `Number.MAX_SAFE_INTEGER`, because unchecked JavaScript rounding makes distinct totals equal. Use exact integer aggregation or reject unsafe aggregates before returning the trial balance.</violation>

<violation number="4" location="src/lib/accounting/engine.ts:141">
P2: `trialBalance` silently classifies unmapped accounts as assets, producing the wrong normal balance for missing liability, equity, revenue, or expense metadata. Fail on a missing `types[accountCode]` instead of returning a fabricated classification.</violation>
</file>

<file name="src/app/(app)/akuntansi/page.tsx">

<violation number="1" location="src/app/(app)/akuntansi/page.tsx:47">
P2: The `Ekuitas + Laba` KPI omits current profit and displays only equity-account balances. Add revenue minus expense to this value so the card matches its label and the financial reports.</violation>
</file>

<file name="src/lib/invoicing/totals.ts">

<violation number="1" location="src/lib/invoicing/totals.ts:60">
P2: `computeLineTotals` accepts quantities above PostgreSQL’s `integer` range. Invoice and POS inserts persist `qty` into integer columns, so these totals pass validation and then fail at the database; reject values above 2,147,483,647 here.</violation>
</file>

<file name="src/lib/budget/service.ts">

<violation number="1" location="src/lib/budget/service.ts:26">
P2: No production module imports this service, so budgeting cannot be reached by the application even though its integration tests pass. Wire these operations into a server action/page before shipping, or remove the dead service until it has a caller.</violation>

<violation number="2" location="src/lib/budget/service.ts:32">
P2: The period validation accepts nonexistent months such as `2026-13`, allowing invalid budgets and misleading zero-actual reports. Validate the month range (`01`–`12`) in all three service entry points and enforce the same calendar constraint in the database.</violation>

<violation number="3" location="src/lib/budget/service.ts:98">
P2: The report converts unrestricted bigint aggregates to `Number`, which silently rounds totals above `Number.MAX_SAFE_INTEGER`. Preserve actual totals as bigint/decimal values, or reject unsafe aggregates before converting them for the response.</violation>
</file>

<file name="src/app/(app)/faktur/page.tsx">

<violation number="1" location="src/app/(app)/faktur/page.tsx:54">
P2: This page fetches and renders every invoice for the organization with no limit or pagination. As invoice history grows, the query and RSC response become unbounded; add bounded pagination and a matching query path.</violation>
</file>

<file name="src/app/(app)/akuntansi/aset/add-asset-dialog.tsx">

<violation number="1" location="src/app/(app)/akuntansi/aset/add-asset-dialog.tsx:98">
P2: Closing this dialog without saving preserves both controlled account selections, so the next asset can be posted with the previous asset’s depreciation accounts. Reset both selections whenever `onOpenChange` receives `false`.</violation>

<violation number="2" location="src/app/(app)/akuntansi/aset/add-asset-dialog.tsx:100">
P2: This admin-only action is rendered to every member on the asset page, causing a misleading form that always fails for non-admins. Pass the role into this component and hide the trigger for non-admin members.</violation>
</file>

<file name="src/app/(app)/akuntansi/new-entry-dialog.tsx">

<violation number="1" location="src/app/(app)/akuntansi/new-entry-dialog.tsx:60">
P2: `balanced` ignores missing account selections, so the form displays “Seimbang — siap disimpan” for rows that the action removes before validation. Require every row to have an account and show a specific account-selection error before enabling submit.</violation>

<violation number="2" location="src/app/(app)/akuntansi/new-entry-dialog.tsx:60">
P2: The dialog enables and labels a draft ready when one or more rows still have no account. Require every row to select an account before setting `balanced`, and show an account-selection error instead of sending filtered rows that the server rejects.</violation>
</file>

<file name="src/app/(app)/akuntansi/jurnal/page.tsx">

<violation number="1" location="src/app/(app)/akuntansi/jurnal/page.tsx:54">
P2: The journal page limits entries to 50 but still loads every line in the organization. Filter lines by the selected entry IDs so page load and memory stay bounded as the ledger grows.</violation>

<violation number="2" location="src/app/(app)/akuntansi/jurnal/page.tsx:98">
P2: The journal displays raw account UUIDs instead of the account code or name. Join or map each line to its account so users can identify the accounts in the journal.</violation>
</file>

<file name="drizzle/0017_confused_silvermane.sql">

<violation number="1" location="drizzle/0017_confused_silvermane.sql:116">
P2: These foreign keys allow a tenant-scoped record to reference another organization’s account, invoice, company, contact, product, or sale. Enforce `(org_id, id)` ownership with composite unique keys and composite foreign keys (or equivalent database constraints) so a bad write cannot corrupt tenant isolation.</violation>
</file>

<file name="src/app/(app)/pos/product-grid.tsx">

<violation number="1" location="src/app/(app)/pos/product-grid.tsx:54">
P2: This calculation can create an unsafe total even though the stored price is valid. With a `Number.MAX_SAFE_INTEGER` product and PPN 100%, `formatIDR(total)` throws during render instead of leaving the user with a checkout validation error; guard unsafe line/subtotal/tax totals before formatting and keep checkout usable.</violation>
</file>

<file name="src/lib/pos/service.integration.test.ts">

<violation number="1" location="src/lib/pos/service.integration.test.ts:116">
P2: The race case is serial, so it cannot detect a lost-update bug in concurrent checkouts. Start two checkouts with `Promise.allSettled` while one unit remains, then assert exactly one succeeds, one rejects, and stock reaches zero.</violation>

<violation number="2" location="src/lib/pos/service.integration.test.ts:167">
P2: The org-B journal assertion omits `balanced`, so an unbalanced transfer entry can pass this test. Assert `tbB.balanced` alongside the debit total.</violation>
</file>

<file name="src/lib/budget/service.integration.test.ts">

<violation number="1" location="src/lib/budget/service.integration.test.ts:82">
P2: This test does not verify the admin-only contract it claims to cover: every `setBudget` call uses an owner, so a regression allowing members to write budgets would still pass. Create a member membership and assert that member `setBudget` rejects with the insufficient-role error.</violation>
</file>

<file name="src/lib/assets/service.integration.test.ts">

<violation number="1" location="src/lib/assets/service.integration.test.ts:89">
P2: The org-isolation case covers only the expense account. Add a complementary request using an organization-A expense account and organization-B accumulated-depreciation account to verify both account fields are scoped.</violation>

<violation number="2" location="src/lib/assets/service.integration.test.ts:94">
P2: This case does not test the two invalid inputs named in its comment. Add separate `salvageValue > cost` and `usefulLifeMonths: 0` calls so those validation paths cannot regress unnoticed.</violation>
</file>

<file name="src/app/(app)/akuntansi/jurnal/close-period-dialog.tsx">

<violation number="1" location="src/app/(app)/akuntansi/jurnal/close-period-dialog.tsx:42">
P2: This control is rendered for every journal member, but `closePeriod` requires admin, so members can open a close-period dialog that can never succeed. Gate the component with the membership role instead of rendering it unconditionally.</violation>
</file>

<file name="src/lib/accounting/engine.test.ts">

<violation number="1" location="src/lib/accounting/engine.test.ts:35">
P2: `/50/` also matches the `50` suffix in the reported total `150`, so this test passes when the delta is wrong. Match `selisih 50` or the exact error message instead.</violation>

<violation number="2" location="src/lib/accounting/engine.test.ts:41">
P2: This fixture is already unbalanced because `SALES` contributes credit 100, so the assertion remains green if zero-line validation is removed. Add a matching `CASH` line or assert the zero-specific error so only the intended rule can satisfy this test.</violation>

<violation number="3" location="src/lib/accounting/engine.test.ts:78">
P2: This test can pass solely on the per-line database-bound error, not aggregate overflow detection. Use per-line-valid amounts whose accumulated total exceeds the safe integer limit and require an `overflow` error.</violation>
</file>

<file name="src/app/(app)/faktur/actions.ts">

<violation number="1" location="src/app/(app)/faktur/actions.ts:60">
P2: The action accepts arbitrary date strings, but `createInvoice` compares them lexically. Validate and normalize both dates at this boundary, or make the service compare parsed calendar dates, so callers cannot create invoices with an earlier due date.</violation>
</file>

<file name="src/app/(app)/akuntansi/buku-besar/page.tsx">

<violation number="1" location="src/app/(app)/akuntansi/buku-besar/page.tsx:79">
P2: These are journal-line rows, not transactions: repeating an account in one entry makes the header count report multiple transactions. Because `listLedger` has no within-entry line order, the per-line running balances can also vary; aggregate per entry or add deterministic line ordering before rendering.</violation>
</file>
```

</details>

<sub>Reply with feedback, questions, or to request a fix.<br /><br />[View guided diff](https://www.cubic.dev/pr/katsugtgz/openbizcrm/pull/8?utm_source=github&utm_medium=review_footer) | [Turn on auto-fix](https://www.cubic.dev/action/auto-fix/pr/katsugtgz/openbizcrm/8?returnTo=https%3A%2F%2Fgithub.com%2Fkatsugtgz%2Fopenbizcrm%2Fpull%2F8) | [Re-trigger cubic](https://www.cubic.dev/action/re-review/pr/katsugtgz/openbizcrm/8/ai_pr_review_github_delivery_780185cbb77b216c5664688a31873060330537e2b236a5d0824f876a2ba80776?returnTo=https%3A%2F%2Fgithub.com%2Fkatsugtgz%2Fopenbizcrm%2Fpull%2F8)</sub>

<!-- cubic:review-post:ai_pr_review_github_delivery_780185cbb77b216c5664688a31873060330537e2b236a5d0824f876a2ba80776:15fc5da11bb3ba3fec1c17ce9651e77a9b69fe19:3619a093-62ec-57fa-b60c-e2b47032664e -->

## Resolution status (round 1) — 2026-10-20

Full pass over all 60 findings. Gates: `bun install` ok; prettier/lint (0 errors, 1 pre-existing warning in tasks/service.ts)/`tsc`/`next build` clean; `RUN_DB_TESTS=1 bun run test:coverage` **285/285 green** (29 files); `db:generate` clean (schema in sync, migration 0019 generated + applied to dev PG).

| Finding                                                              | Status  | Fix                                                                                                                                                                      |
| -------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| assets/service.ts:1 (account type not validated)                     | FIXED   | `requireDepreciationAccounts` — expense/asset type + distinct enforced.                                                                                                  |
| assets/service.ts:2 (MM=00/13 accepted)                              | FIXED   | `^\d{4}-(0[1-9]                                                                                                                                                          | 1[0-2])$` + test "periode bulan 00/13 ditolak". |
| assets/service.ts:3+4 (snapshot before lock, zero-row ignored)       | FIXED   | Advisory `acct:<orgId>` taken inside tx BEFORE `SELECT ... FOR UPDATE`; zero-row update → `skipped`, journal not counted (test: concurrent double-run, exactly 1 posts). |
| assets/service.ts:5+6 (base<life never depreciates; floor remainder) | FIXED   | Catch-up in final life month posts full remainder; test "Tiny" cost 20 / life 24 posts 20 at 2027-12.                                                                    |
| assets/service.ts:7 (journal dated 28th)                             | FIXED   | `lastDayOfMonth(periodEnd)`.                                                                                                                                             |
| assets/service.ts:8 (bypasses period close)                          | FIXED   | Fiscal-period check inside tx; test "closed period blocks depreciation".                                                                                                 |
| assets/service.ts:9 (full depreciation = disposal)                   | FIXED   | Fully-depreciated asset stays `active`; disposal only via `dispose()`.                                                                                                   |
| assets/service.ts:10 (disposal race overwrites)                      | FIXED   | Same `acct:<orgId>` lock in `dispose()` + expected-state predicate; test disposal-vs-depreciation race.                                                                  |
| pos/service.ts:1 (audit second pool connection)                      | FIXED   | `recordAudit(..., tx)` in restock/checkout; audit-repo transaction-aware.                                                                                                |
| pos/service.ts:2 + schema.ts:1 (no inventory_movements)              | FIXED   | `restock`/`sale` movement rows inserted in same tx as stockQty change.                                                                                                   |
| pos/service.ts:3 (entryNumber lock family)                           | FIXED   | checkout takes `acct:<orgId>`; shared with accounting/invoicing/assets.                                                                                                  |
| pos/service.ts:4 (closed-period POS bypass)                          | FIXED   | `fiscal_periods.closed` assert in checkout tx; test "checkout ditolak saat periode fiskal ditutup".                                                                      |
| accounting/service.ts:1 (audit pool deadlock)                        | FIXED   | All in-tx audit calls pass `tx` (create/post/close).                                                                                                                     |
| accounting/service.ts:2 (impossible months)                          | FIXED   | 01–12 range check in `closePeriod`.                                                                                                                                      |
| accounting/service.ts:3 (inconsistent balance snapshot)              | FIXED   | `balanceSheet`/`financialReports` compute all components from one trial-balance snapshot.                                                                                |
| invoicing/service.ts:1 (postJournal line cap)                        | FIXED   | `computeLineTotals` per line + MAX_SAFE totals checks before insert.                                                                                                     |
| invoicing/service.ts:2 (audit second connection)                     | FIXED   | All `recordAudit(..., tx)` inside invoice txs.                                                                                                                           |
| invoicing/service.ts:3 (invoice vs POS different locks)              | FIXED   | Invoice posting/postJournal use `acct:<orgId>` (only `inv:` for invoice-numbering block, orthogonal).                                                                    |
| invoicing/service.ts:4+5 (PPN as revenue)                            | FIXED   | Credit Revenue=subtotal, credit PPN-liability (2-2000, auto-created)=taxAmount; test asserts liability line.                                                             |
| invoicing/service.ts:6 (future-due overdue)                          | FIXED   | `dueDate <= CURRENT_DATE` predicate in markOverdue UPDATE + explicit "belum jatuh tempo" error; NEW test (red→green this round).                                         |
| schema.ts:2 (journal_lines tenant FKs)                               | FIXED   | 0018 composite FKs `(org_id, entry_id)`/`(org_id, account_id)` + parent unique keys.                                                                                     |
| schema.ts:3 (bigint removed engine cap)                              | FIXED   | 0019: `journal_lines_amounts_check` now also bounds debit/credit ≤ 9007199254740991 (MAX_SAFE_INTEGER) — every journal writer shares the constraint.                     |
| schema.ts:4 ((0,0) lines accepted)                                   | FIXED   | Same CHECK requires exactly one positive side; test "journalLines CHECK menolak (0,0)".                                                                                  |
| schema.ts:5 (dangling journal refs)                                  | FIXED   | Composite FKs on invoices/invoice_payments/pos_sales → journal_entries(org,id).                                                                                          |
| laporan/page.tsx:1+2 (3x trial-balance scans)                        | FIXED   | `financialReports` single snapshot for both panels.                                                                                                                      |
| laporan/page.tsx:3 (Laba Rugi cumulative mislabeled)                 | FIXED   | Optional `period` filter + explicit description ("kumulatif"/"bulan X").                                                                                                 |
| engine.ts:1 (MAX_LINE_AMOUNT stale)                                  | FIXED   | `MAX_LINE_AMOUNT = Number.MAX_SAFE_INTEGER`, matches bigint columns + new DB check.                                                                                      |
| engine.ts:2+3 (unsafe aggregation)                                   | FIXED   | BigInt `sumExact` with explicit reject before rounding; overflow tests.                                                                                                  |
| engine.ts:4 (unmapped accounts default asset)                        | FIXED   | `trialBalance` throws on missing `types[accountCode]`.                                                                                                                   |
| akuntansi/page.tsx:1 (KPI omits profit)                              | FIXED   | `pick("equity") + laba`.                                                                                                                                                 |
| invoicing/totals.ts:1 (qty > int max)                                | FIXED   | `QTY_DB_MAX` check; tests at boundary.                                                                                                                                   |
| budget/service.ts:1 (dead service)                                   | WONTFIX | Service is tested + wired for next slice; adding a UI page now is out of scope for this review round (no product request). Tracked as follow-up.                         |
| budget/service.ts:2 (2026-13 accepted)                               | FIXED   | `assertPeriod` format+range in all 3 entry points; DB CHECK on `budgets.period` format.                                                                                  |
| budget/service.ts:3 (bigint→Number rounding)                         | FIXED   | `numberFromAggregate` rejects aggregates > MAX_SAFE; test "aktual di atas MAX_SAFE ditolak".                                                                             |
| faktur/page.tsx:1 (unbounded fetch)                                  | FIXED   | `limit = 100` + "100 faktur terbaru" copy.                                                                                                                               |
| add-asset-dialog.tsx:1 (state persists)                              | FIXED   | `handleOpenChange` resets selections on close.                                                                                                                           |
| add-asset-dialog.tsx:2 (admin control for all)                       | FIXED   | `isAdmin` prop hides trigger.                                                                                                                                            |
| new-entry-dialog.tsx:1+2 (balanced without accounts)                 | FIXED   | `missingAccount` gates balanced + "Pilih akun untuk setiap baris."                                                                                                       |
| jurnal/page.tsx:1 (all lines loaded)                                 | FIXED   | `inArray(entryId, pageIds)`.                                                                                                                                             |
| jurnal/page.tsx:2 (raw UUIDs)                                        | FIXED   | Lines mapped to `code name`.                                                                                                                                             |
| drizzle/0017 (tenant-scoped FKs)                                     | FIXED   | 0018/0019 composite unique + FK constraints.                                                                                                                             |
| product-grid.tsx:1 (formatIDR crash)                                 | FIXED   | `unsafe()` guard + `totalsUsable` gate, checkout stays usable.                                                                                                           |
| pos test:1 (serial race case)                                        | FIXED   | `Promise.allSettled` double checkout, exactly-one-succeeds.                                                                                                              |
| pos test:2 (org-B balanced missing)                                  | FIXED   | `expect(tbB.balanced).toBe(true)`.                                                                                                                                       |
| budget test:1 (admin-only untested)                                  | FIXED   | Real member membership + INSUFFICIENT_ROLE assertion.                                                                                                                    |
| assets test:1 (one-sided org isolation)                              | FIXED   | Complementary cross-org accum-account case.                                                                                                                              |
| assets test:2 (invalid inputs untested)                              | FIXED   | Separate salvage>cost and life=0 cases.                                                                                                                                  |
| close-period-dialog.tsx:1 (members see dialog)                       | FIXED   | `hasRole(role,"admin")` gate returns null for members.                                                                                                                   |
| engine.test.ts:1 (`/50/` matches 150)                                | FIXED   | `/selisih 50\)/`.                                                                                                                                                        |
| engine.test.ts:2 (zero-line test green without rule)                 | FIXED   | Balanced fixture + exact zero-line error assertion.                                                                                                                      |
| engine.test.ts:3 (per-line-bound false pass)                         | FIXED   | Per-line-valid MAX+100 aggregation → `overflow` error.                                                                                                                   |
| faktur/actions.ts:1 (lexical date compare)                           | FIXED   | `normalizeDate` strict `YYYY-MM-DD` + `Date.parse` at boundary.                                                                                                          |
| buku-besar/page.tsx:1 (per-line rows mislabeled)                     | FIXED   | Per-entry aggregation; deterministic order via (date, entryNumber).                                                                                                      |

**60/60 resolved: 59 FIXED, 1 WONTFIX (budget/service.ts:1 — dead-service finding; wiring a new UI page is a feature, not a review fix; tracked as follow-up).**

This round's deltas: markOverdue dueDate guard + test (invoicing/service.ts, service.integration.test.ts), journal-line amount-cap CHECK + migration 0019 (src/db/schema.ts, drizzle/0019_bouncy_xorn.sql), budget overflow test adjusted to per-line caps.
