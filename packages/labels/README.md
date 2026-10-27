# @erp/labels

Roll labels (ADR-0006, ADR-0007): QR + Code 128 of the barcode string only, never cost.

- `renderLabels(rolls, layout)` → PDF (pdf-lib) sized from the `labels.roll.layout` setting (default 100×50 mm, one label per page) or ZPL for thermal printers.
- `pdfSafe(text)` maps characters outside WinAnsi (e.g. ″) so the standard fonts never throw.
- `LABEL_QUEUE` / `labelFileKey(jobId)`: the API renders up to 300 labels inline; bigger batches are queued, rendered by `apps/worker` (`jobs/labels.ts`) and kept in Redis for an hour.
