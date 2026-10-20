<!-- cubic:review-summary:start -->

**5 issues found** across 54 files
<!-- cubic:review-summary:end -->

<details>
<summary>Prompt for AI agents (unresolved issues)</summary>

```text

Check if these issues are valid — if so, understand the root cause of each and fix them. When an issue isn't valid or won't be fixed in this PR, reply in its thread with the reason and then resolve the thread. If appropriate, use sub-agents to investigate and fix each issue separately.


<file name="docs/cubic-pr8-findings.md">

<violation number="1" location="docs/cubic-pr8-findings.md:87">
P3: This findings document repeats several issues as separate violations even though each pair has the same location, root cause, and fix. Consolidate the duplicate entries so agents do not investigate or track the same defect multiple times.</violation>
</file>

<file name="src/app/(app)/faktur/new-invoice-dialog.tsx">

<violation number="1" location="src/app/(app)/faktur/new-invoice-dialog.tsx:54">
P2: Validate `unitPrice` with the same digit-only rule as the server. This guard lets `1e3` and whitespace-wrapped numbers through because `Number(...)` yields 1000, while `parseIDRInput` rejects them, so the dialog shows totals but submission fails.</violation>

<violation number="2" location="src/app/(app)/faktur/new-invoice-dialog.tsx:59">
P2: Guard the aggregate subtotal and tax-inclusive total before returning them. Otherwise two maximum-price items, or one maximum-price item with 100% PPN, make `formatIDR` throw during render and crash the invoice dialog instead of showing validation.</violation>

<violation number="3" location="src/app/(app)/faktur/new-invoice-dialog.tsx:100">
P2: After saving, the reset clears items and company but not `taxPct`; the next invoice silently reuses the previous PPN instead of the initial 0%. Reset `taxPct` with the other form fields.</violation>

<violation number="4" location="src/app/(app)/faktur/new-invoice-dialog.tsx:113">
P2: Reset draft state when the dialog closes, not only after a successful save. Clicking Batal, X, or Escape leaves `items`, `companyId`, and `taxPct` populated, so reopening displays the previous invoice and permits accidental resubmission.</violation>
</file>
```

</details>

<sub>Reply with feedback, questions, or to request a fix.<br /><br />[View guided diff](https://www.cubic.dev/pr/katsugtgz/openbizcrm/pull/8?utm_source=github&utm_medium=review_footer) | [Turn on auto-fix](https://www.cubic.dev/action/auto-fix/pr/katsugtgz/openbizcrm/8?returnTo=https%3A%2F%2Fgithub.com%2Fkatsugtgz%2Fopenbizcrm%2Fpull%2F8) | [Re-trigger cubic](https://www.cubic.dev/action/re-review/pr/katsugtgz/openbizcrm/8/ai_pr_review_github_delivery_f5df1d7f48fbf2b000f1fa60b41197c7dfee451d529dec2bf1a3a9fc812147d3?returnTo=https%3A%2F%2Fgithub.com%2Fkatsugtgz%2Fopenbizcrm%2Fpull%2F8)</sub>

<!-- cubic:review-post:ai_pr_review_github_delivery_f5df1d7f48fbf2b000f1fa60b41197c7dfee451d529dec2bf1a3a9fc812147d3:ca779820474ac6657eb9b89217d0109c07baab6f:0fcea44f-216d-558a-9de8-0f4baf57bc4d -->
