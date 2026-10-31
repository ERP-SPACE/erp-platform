# Stage 6 — Opening Balances, Hardening & Go-Live: implementation plan

**Status:** approved 2026-10-31 with the default answers below (go-live date to follow) · **Branch:** `stage-6-golive` (from `main` after the Stage 5 merge, d4887c4)

## Scope

The brief's Stage 6 has two halves: the **Opening Balance Wizard** and **hardening**. CLAUDE.md and ADR-0019 move all AWS work to **Stage 7 (Cloud deployment)**, after you sign off local UAT. So these brief items are planned for Stage 7, not here:

- RDS point-in-time recovery
- production Terraform
- deploying to production

Stage 6 does the same work on the local stack:

- backups and a restore drill
- a runbook
- the load test

The gate becomes: **a local restore drill succeeds, all PRD §11 UAT passes, and you sign off**. That sign-off starts Stage 7.

The opening **ledger balances** journal (PRD §5.10 last row, UAT §11.7 third item) needs the Chart of Accounts. It belongs to the Accounting stage (A). This stage records **bank and cash balances as data** for it, as the brief says.

## What Stage 6 delivers

### 1. Opening Balance Wizard (`/settings/opening`)

Chapters, in order: **Stock → Receivables → Payables → Bank & cash → Review → Go live** (brief §B4.10). Each chapter:

- uploads a CSV
- shows a **validation report before anything is saved**: errors, warnings, and totals against the figure from your old books
- is saved as one **batch** that can be **discarded** until go-live (PRD §12 "rollback before Go-Live lock")

| Chapter | CSV (template downloadable) | Checks | Creates |
|---|---|---|---|
| **Stock** — roll by roll | barcode (optional; keeps your old one if unique), supplier, SKU *or* GSM + quality + width, metres, landed cost ₹/m, received date, batch ref | Unknown SKU or supplier, duplicate barcode, width or GSM not in Settings, metres ≤ 0. **Σ value must equal your books' inventory value to the paisa** | Rolls **Mapped**, with landed cost (UAT §11.7). Created through an **opening GRN** per supplier, so rolls are still created only by GRN posting (ADR-0017), and their lineage shows "Opening stock". |
| **Stock** — per SKU (when there is no roll list) | SKU, rolls, metres, value | Same, plus the rolls × length must make sense | That many rolls of equal length with new barcodes (Q41), cost = value ÷ metres, labels ready to print |
| **Receivables** | customer, invoice no., date, amount, due date (optional) | **Unrecognised customers flagged** (match on code, GSTIN or exact name), duplicate invoice no., future dates. Σ = your books' debtors | **Opening invoices** in the customer sub-ledger (Q42). They count in outstanding, aging, credit exposure, statements and receipt allocation from day one. No GST, IRN, COGS, commission or sales-report revenue |
| **Payables** | supplier, invoice no., date, amount, due date | Same for suppliers | Opening invoices on the supplier side, payable through supplier payments |
| **Bank & cash** | One entry per account: name, kind (bank / cash), bank & last 4 digits, balance, as-of date | Accountant confirms each with their password | Stored for the Accounting stage; nothing posts |
| **Review** | — | Every chapter's totals beside your books' figures, unresolved warnings, who imported what | — |
| **Go live** | — | All chapters confirmed or marked "not needed" | The **Go-Live lock** |

### 2. Go-Live lock

- Opening data is dated the day before the **go-live date** (new setting `golive.date`).
- The wizard locks **on the first live posting**, whichever comes first (PRD §5.10): a GRN, SI, receipt or payment, or a stock adjustment dated on/after go-live. It can also be locked by hand with "Go live" (Owner, with password, step-up as listed in CLAUDE.md).
- After the lock, opening batches are read-only, enforced by a **DB trigger**, not just the screen. Corrections use the normal documents with a reason:
  - **stock:** a length correction or scrap on the roll
  - **AR/AP:** a credit/debit note or receipt against the opening invoice
- Every import, discard and the lock itself are audited and written as `posting_events` (`OPENING_STOCK`, `OPENING_AR`, `OPENING_AP`, `OPENING_CASH`, `GO_LIVE`). Stage A can then post the opening journal from them.

### 3. Hardening (local)

- **Authorisation tests per permission:**
  - **Every route:** a generated test hits every route with a user lacking its permission and expects 403, so a route added later without `@RequirePermission` fails CI.
  - **Step-up:** every step-up permission is checked to demand a fresh login.
- **IDOR tests:** a customer-scoped user cannot read, export or pivot another customer's documents by id. This covers SO, DC, SI, CN, receipts, statements, reports, exports and saved pivots.
- **Rate limits:**
  - sign-in (already in place, re-checked)
  - per-user API limit (default 600 requests/min)
  - stricter limits on exports, PDFs and Refresh now
  - Over the limit returns 429 `RATE_LIMITED` with `Retry-After`.
- **Load test (k6) at 3× expected load:** 45 virtual users (15 × 3, Q46) on the realistic daily mix: scan, SO, DC, SI, receipt, Today, reports. It runs against the local stack seeded with 50k rolls. The report records p95 per endpoint against the CLAUDE.md budgets.
- **Backups and restore drill:**
  - a nightly `pg_dump` (custom format) job in the worker, kept 30 days in `.backups/` (setting)
  - `pnpm db:restore-drill`: restores the latest dump into a scratch database, then runs row counts, the double-check views and a sample of reports, and prints PASS/FAIL
  - Point-in-time recovery comes with RDS in Stage 7.
- **Audit partition archival** (Q45): monthly audit partitions older than 13 months are written as compressed CSV to storage and moved to an `audit_archive` schema. They stay queryable, and nothing is deleted before the 7-year retention (CLAUDE.md rule 7).
- **Runbook** `docs/runbook.md`: start/stop, deploy a new version, roll back, back up and restore, rotate secrets, add a user, unlock a stuck queue. AWS sections are left as Stage 7 placeholders.
- **User guide per role** `docs/user-guide/` (Q47): short and illustrated with screenshots. One each for the Owner, sales, warehouse (`/floor`), accounts and purchase.
- **Full PRD §11 regression:** every stage's gate re-run, plus UAT §11.7.

## Decisions built in

| Topic | Decision | Source |
|---|---|---|
| Opening stock goes through a GRN | An "opening GRN" per supplier (series `OB`, no PO, no PI) creates the rolls, so the rule "rolls only at GRN posting" holds and the Roll Inspector lineage stays complete | ADR-0017 |
| Opening invoices | Rows in `sales_invoices` / `purchase_invoices` with `source = 'OPENING'`, the old invoice number kept in `legacy_no`, no lines, `einvoice_status = NotRequired`. Every receivable and payable query keeps working; GST, COGS, commission and the reporting views ignore them | PRD §5.10, reuses Stage 4 |
| Totals must match | Stock value, debtors and creditors must equal the figures you enter from your books **to the paisa** before a chapter can be confirmed (Q43) | PRD §5.10 |
| One batch per upload | Discarding a batch removes everything it created, but only while nothing has touched those rolls or invoices | PRD §12 |
| Lock | Automatic on the first live posting; manual "Go live" needs the Owner's password; enforced in the database | PRD §5.10, CLAUDE.md rule 10 |
| AWS | Stage 7 | ADR-0019 |

## Build steps (one commit each, local until you approve the push)

1. **Domain:** CSV row parsing and validation (pure), equal-length roll split with largest remainder (Q41), book-total checks, lock rules; property tests.
2. **Contracts, permissions, settings:**
   - permissions `opening.manage` and `golive.lock` (step-up)
   - settings `golive.date`, `backup.retentionDays`, `audit.archiveAfterMonths`, `api.rateLimitPerMinute`
   - series `OB`; CSV templates
3. **Database:**
   - `opening_batches`, `opening_cash_balances`
   - `source = 'OPENING'` and `legacy_no` on sales and purchase invoices
   - opening GRN support
   - go-live lock row and trigger
   - `audit_archive` schema and archival function
4. **API:**
   - upload, validate, confirm and discard per chapter; review; go live
   - integration tests for UAT §11.7: stock imported Mapped with the right landed cost, AR matching your books, the lock on the first live posting
   - opening invoices in aging, credit and allocation
5. **Worker:** nightly backup, audit archival, restore-drill script.
6. **Web:** the wizard (chapter stepper, upload, validation report, review, go live), template downloads, opening stock labels. **→ screenshots to you for review.**
7. **Hardening:** per-permission and IDOR test suites, rate limits, k6 load test and report, runbook, user guides.
8. **Gate:**
   - restore drill PASS
   - UAT §11.7 in Playwright
   - full PRD §11 regression and full isolated run
   - axe on the wizard
   - docs
   - → your sign-off, which opens Stage 7

## Questions (defaults are what I will build if you agree)

| # | Question | Default |
|---|---|---|
| Q25 *(open)* | Where will opening balances come from: a Tally export, spreadsheets? Is a roll-by-roll stock list possible? | Build both stock routes (roll list and per-SKU totals); AR/AP from any spreadsheet saved as CSV in the template's columns |
| Q26 *(open)* | Target go-live date? | Needed for the setting; the build doesn't depend on it |
| Q41 | Per-SKU stock: how should it become rolls? | Rolls of the SKU's standard length (1,000 m), the last one shorter; new barcodes; labels printed before the stock is used |
| Q42 | Opening invoices: keep your old invoice numbers on statements? | Yes, shown as the old number with an "Opening" badge; their dates and due dates are kept, so aging and credit start correct |
| Q43 | Must totals match your books exactly? | Exactly, to the paisa; a difference blocks the chapter until fixed |
| Q44 | Should the lock happen automatically on the first live posting, or only when you press "Go live"? | Both: automatic on the first live posting (PRD), or earlier by hand |
| Q45 | Audit log archival: when should old months move to the archive? | After 13 months; still searchable by the Owner; deleted only after 7 years |
| Q46 | Load profile for the 3× test: how many people at peak and doing what? | 15 concurrent users → 45 virtual users; mostly scans, orders, invoices and receipts, a few reports |
| Q47 | User guides: language and format? | English, short Markdown pages with screenshots, one per role; printable |

Still open from earlier: Q31 (allocation swap overshoot), Q27 (NIC sandbox credentials for the real IRN test).
