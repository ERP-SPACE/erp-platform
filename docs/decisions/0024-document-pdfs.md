# 0024 — Document PDFs: HTML templates in a package, Chromium in the worker

- **Status:** Accepted
- **Date:** 2026-10-28
- **Needs confirmation from:** owner (the look of the invoice print, Q30, at the step 7 screen review)

## Context
Invoices, notes, challans and proformas must print as PDFs (PRD §5.7). The brief names Playwright for PDFs in the worker. The document data (scope-checked details, company profile, settings, IRN) lives in the API's services.

## Decision
- **Templates:** `@erp/documents` turns a plain `SalesDocument` object into self-contained A4 HTML — no I/O, easy to test and to preview on screen.
- **Who builds what:** the API builds the `SalesDocument` from the same detail the screens show (customer scope and cost hiding apply) and renders the HTML. The worker turns the HTML into a PDF with headless Chromium (`playwright-core`) over the `erp-documents` BullMQ queue; the API waits up to 30 s and answers 503 `PDF_UNAVAILABLE` if the worker is down. `PDF_RENDERER=inline` runs Chromium in the API instead (tests, single-process installs).
- **Endpoints:** `GET /sales-invoices|customer-notes|delivery-challans|proformas/:id/pdf`, with `?format=html` for the same page as HTML.
- **On demand, not stored:** PDFs are rendered on request, so they always reflect the current IRN, e-way bill and status. Archiving issued PDFs (e.g. to S3) can come with Stage 7 if the CA wants immutable copies.
- **Provisional until the IRN exists** (ADR-0011): a posted B2B invoice or note without an IRN prints with a "Provisional — IRN pending" watermark and no IRN block.

## Consequences
- Chromium is a worker dependency (installed with Playwright); the API stays light.
- The first PDF after a worker start takes ~1 s longer while Chromium launches.
