# Spec: OpenBizCRM App Shell + Module Tracks

## Problem Statement

Indonesian SMBs pay ~Rp500rb/month for Kolabo to run HR, payroll, CRM, accounting, projects and chat. Teams that need those workflows (attendance with GPS/WiFi, PPh 21 + BPJS payroll, deal pipelines, double-entry accounting, company chat) have no free, open-source, self-hostable alternative with Indonesian payroll/tax rules built in.

## Solution

OpenBizCRM: a single Next.js monolith giving companies (multi-org, multi-branch) the same module surface as Kolabo — feature parity, original code and branding. UI in Bahasa Indonesia. Bun as package manager, Postgres via Drizzle, WorkOS AuthKit for org-based auth, Cloudflare Pages hosting, R2 for file storage, Ably for chat realtime.

## User Stories

### Platform / Shell

1. As an owner, I want to create a company workspace, so that my business data is isolated from other companies.
2. As an owner, I want to invite users to my workspace with a role (owner/admin/member), so that access is controlled.
3. As a member of multiple companies, I want to switch active workspace, so that I use one account across employers.
4. As an admin, I want branch management (multi-cabang), so that locations share one company but keep separate settings.
5. As any user, I want to log in with email or Google through WorkOS AuthKit, so that I don't manage passwords.
6. As an admin, I want an audit log of important actions, so that changes are traceable.
7. As any user, I want the app installable as a PWA on my phone, so that I can check in without an app store.
8. As any user, I want the UI in Bahasa Indonesia, so that my staff understand it without English.

### HRM Track

9. As an HR admin, I want employee records (profile, position, department, salary base, join date), so that company data is centralized.
10. As an employee, I want to check in/out from my phone with GPS location captured, so that attendance works for field and office staff.
11. As an employee, I want attendance validated against office WiFi presence, so that office check-ins are verified without GPS ambiguity.
12. As an HR admin, I want shift schedules per employee/branch, so that attendance is judged against the right work hours.
13. As an employee, I want to request WFH/WFA, so that remote work is recorded and approved.
14. As an employee, I want to log field visits (kunjungan) with location, so that client visits are tracked.
15. As an employee, I want to request overtime, so that extra hours are approved and paid correctly.
16. As an HR admin, I want automatic lateness and overtime computation from attendance, so that payroll inputs are accurate.
17. As an employee, I want to request leave (cuti/izin) with attachment, so that time off is approved with evidence.
18. As an HR admin, I want leave quotas per employee per year, so that leave balances are enforced.
19. As a manager, I want multi-level approval queues for attendance/leave/overtime/reimbursement, so that requests follow company policy.
20. As an HR admin, I want company holiday calendars per branch, so that payroll skips holidays correctly.
21. As an HR admin, I want announcements (pengumuman) targeted to company/branch, so that staff get informed in-app.
22. As HR/manager, I want 360 feedback review periods where peers/subordinates/self review each other, so that performance is assessed from all directions.
23. As an HR admin, I want an LMS with courses and materials employees can complete, so that training is trackable.
24. As an HR admin, I want an e-recruitment pipeline (job posting → candidate → stages → interview → offer → onboard as employee), so that hiring lives in the same system.
25. As an employee, I want a penalty-point record (poin penalti) view of my policy violations, so that consequences are transparent.
26. As an employee, I want to claim meals via the canteen module (kantin), so that meal benefits are administered.
27. As an employee, I want to submit reimbursement and cash advance (kas bon) requests, so that out-of-pocket costs are repaid.
28. As a payroll admin, I want a payroll run per period that computes gross→net with PPh 21 TER (PMK 168/2023), BPJS Kesehatan (4% employer / 2% employee capped at 12jt base) and BPJS TK programs (JHT 3.7%/2%, JP 2%/1%, JKK, JKM, JKN classes), so that salaries are legal and correct.
29. As a payroll admin, I want THR calculation (proportional by months worked for ≥1 month tenure), so that religious holiday pay is compliant.
30. As a payroll admin, I want overtime pay computed per UU 13/2003 formulas (1.5×/2×/3× hourly base by day type), so that overtime is lawful.
31. As an employee, I want to download my payslip (slip gaji) as PDF, so that I have proof of income.
32. As a payroll admin, I want a bank transfer export file per run, so that disbursement matches bank bulk-transfer formats.
33. As a payroll admin, I want savings & loans (simpanan & pinjaman) tracking with installments deducted in payroll, so that employee cooperatives work.
34. As an employee, I want an attendance + task + payslip self-service dashboard, so that I don't ask HR for my own data.

### CRM + Projects Track

35. As a salesperson, I want contacts and companies (clients & leads) management, so that relationships are tracked.
36. As a salesperson, I want a deal pipeline with stages (Leads Baru → Sudah Dihubungi → Dijadwalkan Meeting → Quotation Dikirim → Close), so that I know where every deal stands.
37. As a sales manager, I want All Deals / My Deals board views with tags, status and owner, so that the team's pipeline is visible.
38. As a salesperson, I want quotations with product line items in IDR, so that quotes are sent from the system.
39. As a salesperson, I want activities (calls, tasks, due dates) attached to deals, so that follow-ups aren't dropped.
40. As a salesperson, I want a command-palette search (Ctrl+K), so that I find any record fast.
41. As a PM, I want clients linked to projects, so that project work maps to accounts.
42. As a PM, I want projects with members and date ranges, so that work is organized.
43. As a PM, I want a Kanban board for tasks with drag between columns, so that progress is visual.
44. As a PM, I want a Gantt chart view (weekly) of project tasks, so that scheduling conflicts are visible.
45. As a PM, I want daily task auto-generation for recurring routines, so that daily ops are pre-created.
46. As an employee, I want a timesheet with start/stop timers per task, so that hours are captured without manual entry.
47. As a PM, I want project progress tracking (task completion %), so that on-time completion is measurable.

### Finance Track

48. As an accountant, I want a chart of accounts per company, so that the ledger is structured.
49. As an accountant, I want journal entries with balanced double-entry validation, so that books never drift.
50. As an accountant, I want a general ledger (buku besar) view per account, so that history is auditable.
51. As an accountant, I want financial statements (income statement, balance sheet) generated from postings, so that reporting is automatic.
52. As an accountant, I want AR/AP tracking from invoices and bills, so that receivables/payables are managed.
53. As an accountant, I want invoicing (faktur) with IDR line items and tax, so that billing is in-system.
54. As an accountant, I want budgeting per account per period with actual-vs-budget report, so that spend is controlled.
55. As an accountant, I want fixed asset management with depreciation, so that asset values are tracked.
56. As a cashier, I want POS: products, quick checkout, payment, per-branch, so that retail sales are captured.
57. As an accountant, I want POS sales auto-posted to accounting, so that retail and books agree.
58. As a manager, I want income vs expense reports, so that cash health is visible.
59. As an accountant, I want all money stored as integer IDR (no floats), so that rounding never corrupts totals.

### Collaboration Track

60. As an employee, I want personal and group chat within my company, so that communication stays internal.
61. As a chat user, I want file/image sharing in conversations, so that context travels with the message.
62. As a chat user, I want voice notes, so that quick updates don't require typing.
63. As an employee, I want a company cloud drive (folders, upload, share) backed by R2, so that documents are centralized.
64. As an employee, I want to start a video meeting (Jitsi embed) from chat, so that calls happen without external tools.
65. As an admin, I want WhatsApp notifications (payslip ready, announcements) via Baileys session, so that staff get pinged where they actually read.
66. As an admin, I want WhatsApp blast to contact lists, so that campaigns go out from the platform. (Accepted risk: unofficial API, number-ban exposure.)
67. As an admin, I want WhatsApp auto-reply rules, so that inbound messages get instant responses.
68. As an employee, I want a form builder (Kolabo Form parity) with shareable public forms, so that surveys/intake happen in-platform.
69. As a manager, I want AI meeting recap: recording → transcript → summary → PDF export, so that meetings produce artifacts.
70. As any user, I want an AI assistant grounded in my workspace data, so that I can ask "who hasn't checked in today" style questions.
71. As an asset admin, I want company asset tracking (assignment, condition), so that equipment is accountable.
72. As a manager, I want cross-module reports and a dashboard (attendance, sales, finance, projects), so that decisions use live data.

## Implementation Decisions

- **Monolith.** One Next.js 16 App Router app. Server actions for mutations. No separate API server.
- **Bun discipline.** Bun is package manager + script runner only. Next.js always runs on Node (Turbopack breaks under Bun runtime). CI and docs enforce this.
- **Multi-tenancy.** WorkOS organizations = companies. Every tenant table carries `orgId`; all queries go through org-scoped repositories, never raw table access in UI code. Branches scope within org.
- **Seams (test boundaries), fewest possible:**
  1. `calculatePayroll(input) → Payslip` — pure module: PPh 21 TER, BPJS, THR, overtime, deductions. No I/O. Highest-value seam in the app.
  2. `postJournal(entries) → Posting` — pure double-entry validator + poster; invariant debits == credits, throws on imbalance.
  3. `approval(entityType, entityId, decision)` — single generic approval state machine (draft → submitted → approved/rejected, multi-level levels) shared by attendance/leave/overtime/reimbursement/canteen/loans.
  4. Org-scoped repositories per module — the only DB access layer; server actions call repos.
  5. `storage` adapter — S3 API (R2 prod / MinIO dev) behind one interface.
  6. `ai.complete(prompt, context)` provider adapter — 9router gateway dev, Gemini free tier prod fallback.
- **Money.** Integer IDR everywhere (bigint columns). No decimal floats. Rounding rules documented per payroll component.
- **Schema.** Foundation tables exist (organizations, branches, users, orgMemberships, auditLogs). Each track adds its tables via Drizzle migrations in its own review gate.
- **Realtime.** Chat via Ably channels per conversation; message persistence in Postgres; Ably only for transport/presence.
- **Files.** Presigned-URL uploads direct to R2/MinIO; quota per org tracked in DB.
- **WhatsApp.** Baileys session as separate Bun process (only place Bun runtime is used); talks to main app over internal API token. Blast/auto-reply/notify share one session service.
- **AI.** Vercel AI SDK style provider abstraction; gateway URL from env in dev; Gemini free tier as default prod provider.
- **Motion.** tw-animate-css (already in shadcn) + View Transitions API + torph TextMorph. No JS animation library.
- **PWA.** Web manifest + service worker; GPS check-in uses Geolocation API; WiFi check-in proves office network by having the browser hit a known LAN endpoint route through the server.

## Testing Decisions

- Good tests test external behavior of a seam, not internals: input → output, invariants, error cases. No mock-the-DB tests of repositories.
- **Vitest unit (required, CI-gated):** payroll engine (known-answer tests from official PMK 168/2023 TER tables, BPJS rate tables, THR proration, overtime multipliers — real computed cases with expected IDR outputs), journal posting (balance invariant, refusal cases), approval state machine (legal/illegal transitions, multi-level), money helpers.
- Coverage thresholds start at 60% global (skeleton baseline); payroll + accounting modules individually must exceed 90%.
- **E2E:** dry-run readiness check is CI-gated now; real browser e2e (Playwright) added with the shell phase for login → org create → employee create smoke path.
- Prior art: this repo's `env.test.ts` unit style; payroll tests will be the pattern-setter for known-answer tables.

## Out of Scope

- Kolabo Terminal NFC hardware integration (no hardware).
- Native iOS/Android apps (PWA covers mobile).
- WhatsApp official Cloud API (user chose Baileys, accepted ban risk).
- Visual/brand copying from Kolabo (original branding only; feature parity only).
- Internationalization beyond Indonesian UI strings.
- Scale assumptions beyond <100 users per org.

## Further Notes

- Repo: `katsugtgz/openbizcrm`, public OSS, MIT, Conventional Commits, CI (quality/test/build/e2e-dry-run), CodeQL, dependency review, tag releases.
- **UI/UX front-end work — mandatory agent workflow:** any UI/UX or front-end implementation task must first run the `/frontend-design` skill (aesthetic direction, typography, intentional non-templated visuals) and the `/modern-web-guidance` skill (`npx -y modern-web-guidance@latest search "<query>"` → `retrieve <id>` → verify implementation against the retrieved guide) before writing code. Applies to landing page, dashboard shell, module screens, PWA shell. Skip only for pure logic/data tasks with no rendered surface.
- Disclaimer to keep visible: not affiliated with Kolabo/Langit Solutions; original implementation of feature concepts.
- Build order after this spec: shell phase (auth, org switcher, nav, layout, PWA manifest, repos) → parallel tracks HRM / CRM+Projects / Finance / Collaboration, each ending in a review gate.
- Real Indonesian payroll figures must come from cited official sources fetched at build time (PMK 168/2023 TER monthly table, BPJS contribution rates, UU 13/2003 overtime) — agents must not recite from memory.
