# Stage 5 — Reports, Analytics & Today: implementation plan

**Status:** approved 2026-10-30 with the default answers below · **Branch:** `stage-5-reports` (from `main` after the Stage 4 merge, aec4feb)

## What Stage 5 delivers

The owner opens the ERP in the morning and sees, on one screen, what happened yesterday, what is waiting on them, and where the money and stock are. Every PRD §9 report (except the accounting statements) is a screen with filters, drill-down to the documents behind each number, and export. A pivot builder answers the questions no fixed report covers.

**1. Today (replaces the current dashboard, role-aware)** — in the ADR-0022 dashboard style, not the brief's "ledger front page":

- Header: date, "as of 14:32" stamp, one summary sentence generated from the data ("₹4.8 L invoiced today across 12 invoices; ₹2.1 L collected; 3 orders on hold, ₹2.4 L exposure").
- KPI cards (PRD §9.7): today's orders, invoices, collections, credit blocks, unmapped rolls, gross margin (month to date).
- **Needs you**: a worklist where each row opens the place to act — rate approvals, credit holds, unmapped rolls older than 24 h, challans waiting for an invoice, receipts with money on account, IRNs failed, supplier payments awaiting approval.
- Charts (visx): 30-day sales line, AR aging waterfall, stock aging heatmap (GSM × width, shade = age).
- Role filtering: Owner / managers see everything; **Warehouse** sees rolls to map, challans to pick, returns to inspect; **Accounts** sees receipts to allocate, IRN failures, payments to approve, overdue customers; **Sales** sees their own customers only (existing query-layer scoping).

**2. Reports** (`/reports`, one page each: filters in the URL, sortable table, totals row, drill-down, "as of" stamp, CSV / XLSX / PDF export):

| PRD | Report | Source |
|---|---|---|
| 9.1 | Stock by SKU / batch / supplier (quantity + value) | existing views `mv_stock_by_*` |
| 9.1 | Unmapped rolls with age since GRN | live (small) |
| 9.1 | Batch aging (> 90, > 180 days highlighted) · Dead stock (no movement > 180 days, setting) | new view |
| 9.1 | PO vs GRN vs PI variance per PO line | new view |
| 9.1 | Challans pending invoice · SO backorder (open lines not dispatched) | live |
| 9.2 | Customer sales trend (customer / group / period) · SKU volume & value | new view `mv_sales_lines` |
| 9.2 | Override frequency by salesman · Discount impact (customer / period) | new view |
| 9.2 | Churn risk (no order in > 60 days, setting) · Salesman performance (metres, value, commission) | new view |
| 9.3 | Supplier reliability (GRN rejection, short supply) · Landed cost trend per SKU by supplier · Supplier lead time (PO approval → GRN post) | new view |
| 9.4 | AR aging (Stage 4 screen, linked) · Credit utilisation (exposure vs limit) · Blocked orders (Stage 4, linked) · Collection efficiency (DSO by month) | live + new view |
| 9.5 | Payment allocation status (receipts / payments with money unallocated) | live |
| 9.6 | Gross margin by SKU / customer / month (revenue − COGS, net of credit notes and returns) · Price vs COGS per roll · Scrap impact per period · Commission payout summary (accrued, paid, outstanding) | new view |

Not in Stage 5 (Accounting stage): ledger extract and GST summary (PRD 9.5).

**3. Pivot builder** (`/reports/pivot`):

- Rows / columns from: SKU (and its parts: category, GSM, quality, width), customer, customer group, supplier, salesman, date (day / month / quarter / FY).
- Measures: metres, rolls, sales value (taxable), COGS, margin, margin %.
- Filters on any dimension plus a date range; totals and subtotals.
- **Save** a pivot by name, **share** it with roles or everyone; it opens with live data.
- Runs on the sales-lines view only (fixed list of dimensions and measures; no free SQL).

**4. Exports in the worker:** the request queues a job; the worker builds CSV, XLSX or PDF from the same query the screen uses, stores it through the file-storage adapter (local `.storage/` now, S3 in Stage 7, ADR-0023), and the user gets a notification with a download link that expires after 7 days.

## Decisions built in

| Topic | Decision | Source |
|---|---|---|
| Freshness | Views refresh every 3 min 08:00–20:00 IST, every 30 min otherwise, `CONCURRENTLY`, through the existing `analytics.refresh` job; each report shows "as of". Live (no view): credit, holds, unmapped rolls, pending challans, backorders, allocation status | ADR-0005 |
| Revenue and margin | Taxable value of posted invoices, minus credit notes, plus debit notes; COGS = cost of rolls sold (Stage 3) minus cost returned. Excludes GST and round-off. Dated by the document date | Stage 3 COGS, PRD 9.6 |
| Scoping | Every report and the pivot go through the same customer / product-family scope as the lists; a Sales user's numbers are their own customers only | CLAUDE.md rule 10 |
| Cost visibility | Cost, COGS and margin columns need a new permission `reports.margin.view` (Owner, managers, Accounts); without it they are hidden in screens, pivot and exports | PRD role matrix (cost is never on labels) |
| Settings, not constants | Dead-stock days (180, exists), aging highlight days (90 / 180), churn days (60, new), export link lifetime (7 days, new) | CLAUDE.md rule 9 |
| Charts | visx, thin lines, theme tokens, every chart also shown as a table for screen readers | ADR-0022, WCAG AA |
| Reconciliation | Each report's totals are tested against the documents themselves (e.g. sales report total = sum of posted SIs − CNs for the period) | Brief gate |

## Build steps (one commit each, local until you approve the push)

1. **Domain:** pure helpers for periods (FY / quarter / month buckets in IST), DSO, margin %, churn, pivot grouping and totals (largest-remainder for any split), Today summary sentence and Needs-you ranking; property tests that pivot totals equal the grand total under any grouping.
2. **Contracts, permissions, settings:** report and pivot DTOs; permissions `reports.view`, `reports.margin.view`, `reports.pivot.share`, `reports.export`; settings `reports.churnDays`, `reports.agingHighlightDays`, `reports.exportLinkDays`, `analytics.refreshMinutes` (3 / 30).
3. **Database:** materialized views `mv_sales_lines` (one row per invoice / note line with SKU, customer, group, salesman, metres, value, COGS), `mv_stock_aging`, `mv_purchase_lines` (PO / GRN / PI per line, lead time, rejection, landed cost), `mv_dso_monthly`; unique indexes for concurrent refresh; refresh functions added to `ANALYTICS_REFRESH_FUNCTIONS`; tables `saved_pivots`, `exports`.
4. **API — reports module:** one endpoint per report (filters, sort, page, totals, as-of), pivot query and saved pivots, Today endpoint per role, export request / status / download; integration tests with **reconciliation** tests for every report; performance tests on the 50k-roll dataset (Today < 1.5 s p95, reports < 300 ms p95 for a page).
5. **Worker:** CSV / XLSX / PDF export jobs (XLSX via ExcelJS, PDF via the Stage 3 pipeline), storage, notification with link; the refresh schedule split into business / off hours.
6. **Web:** Today page with KPIs, Needs-you list and the three visx charts; Reports section (index grouped as PRD §9, a shared report page layout); pivot builder; export menu and a "My exports" list. **→ screenshots to you for review.**
7. **Gate:** Today < 1.5 s p95 on 50k rolls; reconciliation tests for every report; Playwright: Today per role, a report drill-down, a saved and shared pivot, an XLSX export downloaded; axe light and dark; docs; full isolated run.

## Questions (defaults are what I will build if you agree)

| # | Question | Default |
|---|---|---|
| Q36 | Who may see cost, COGS and margin in reports? | Owner, Sales Manager, Purchase Manager, Accounts. Salesmen and Warehouse never |
| Q37 | Gross margin: should freight-out or commission be deducted, or is it revenue − landed COGS only? | Revenue − landed COGS only (PRD wording); commission shown separately |
| Q38 | Churn risk: 60 days with no **order**, or no **invoice**? Count customers who never ordered? | No confirmed order in 60 days; only customers who ordered at least once |
| Q39 | Saved pivots: shared with everyone or with chosen roles? | Private by default; share with chosen roles |
| Q40 | Today for the Owner: should the summary also be emailed each morning (Mailpit locally)? | Not now; on screen only (easy to add later) |

Still open from earlier: Q31 (allocation swap overshoot).
