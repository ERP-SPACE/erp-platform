# 0025 — Reports: one runner over views and live SQL; exports as a background job in the API

- **Status:** Accepted
- **Date:** 2026-10-30
- **Needs confirmation from:** —

## Context
Stage 5 builds every PRD §9 report (except accounting statements), a pivot builder, the role-aware Today page and CSV / XLSX / PDF exports. The brief says exports "run in the worker and land in S3 with a download link". Reports must respect customer scope and hide cost from users without `reports.margin.view` (Q36), and every report must reconcile with its documents.

## Decision
- **Facts in views, logic in one place.** Materialized views (migration 0012) hold the heavy joins: `mv_sales_lines` (one row per roll sold, charge, returned roll and note line; a line's taxable value is split over its rolls with largest-remainder paise), `mv_stock_aging`, `mv_purchase_lines`, `mv_landed_cost_monthly`, `mv_scrap`, `mv_dso_monthly`. They refresh with the stock views every 3 min in business hours (ADR-0005). Credit, holds, unmapped rolls, pending challans, backlog and unallocated money stay live.
- **One report runner.** Each report is a definition (`report-definitions.ts`): columns with a kind, a SQL query whose columns are named after them, default sort, search columns, links and highlight rules. The runner wraps the query for search, sort, paging and totals in SQL, applies the customer scope, and drops cost columns from the response (not just the screen) when the user lacks `reports.margin.view`. Two small reports (credit utilisation, DSO) compute rows in code from shared services — credit utilisation uses the same `CreditService` as the order screen, so the numbers agree.
- **Pivot** aggregates `mv_sales_lines` in SQL by the chosen dimensions, then `@erp/domain` `pivot()` builds the grid with exact totals. Capped at 500 rows × 60 columns (`truncated` says so).
- **Exports run as a BullMQ job in the API process** (`erp-exports`, consumed when `API_JOBS=true`), like the IRN and credit queues, not in the worker. The job reruns the screen's query as the requesting user, with the cost visibility they had when they asked, so an export can never show more than the screen did. Files go through `StorageService` (local `.storage/` now, S3 in Stage 7 — ADR-0023); links expire after `reports.exportLinkDays` (7) and an hourly sweep deletes expired files. PDFs are still rendered by the worker's Chromium (ADR-0024). XLSX uses ExcelJS; CSV starts with a BOM and neutralises leading `= + - @` (CSV injection).

## Alternatives considered
- **Exports in the worker:** the worker would need its own copy of every report query, the customer-scope rules and the cost rules — two places to keep in step, and a way for exports to drift from the screens. Rejected; the worker keeps rendering only.
- **One view per report:** more views to refresh and keep reconciled; most reports are cheap aggregates over the same facts.

## Consequences
- The API process does the export work; at < 15 users and small row counts this is negligible. If exports grow large, the consumer can move to a second API instance with `API_JOBS=true` without code changes.
- A user is told an export is ready on the "My exports" list (no in-app notification yet; the notifications outbox has no consumer before Stage B).
