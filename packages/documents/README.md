# @erp/documents

Printable sales documents (PRD §5.7; Q30: the content and order of the owner's bill R/649 in a cleaner layout; ADR-0024).

- `renderSalesDocumentHtml(doc)`: pure function, `SalesDocument` → one self-contained A4 HTML page per copy (Original / Duplicate / Triplicate from Settings → `invoice.pdf`). Tax invoice, credit / debit note, delivery challan (no prices), proforma.
  - Watermarks: Draft, Cancelled, and "Provisional — IRN pending" for a posted B2B document without its IRN (ADR-0011).
  - The e-invoice QR is the IRP's signed QR string, printed as-is (bwip-js SVG).
- `inr()`: Indian grouping. `rupeesInWords()`: amount in words (lakh / crore).
- `@erp/documents/pdf` → `htmlToPdf(html)`: headless Chromium via `playwright-core`; one browser per process. Only the worker imports it (and the API when `PDF_RENDERER=inline`). Needs the Playwright Chromium: `pnpm --filter @erp/web exec playwright install chromium`.
- `DOCUMENT_QUEUE`: the API sends finished HTML; the worker replies with the PDF.
