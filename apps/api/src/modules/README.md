# API modules

Each module is a NestJS module: controller (routes, permissions), service (business logic, one
`UnitOfWork.run` per command), and DTOs built from the Zod schemas in `@erp/contracts`.

| Module | Routes | Notes |
|---|---|---|
| `identity` | `/me`, `/users`, `/roles`, `/permissions`, `/identity/step-up` | Better Auth sessions; step-up per ADR-0021 |
| `settings` | `/settings`, `/company` | Typed settings registry (`@erp/contracts/settings`); `SettingsService.value(key)` for other modules |
| `series` | `/document-series` | Gapless numbering per FY (ADR-0003) |
| `audit` | `/audit` | Reads the trigger-written `audit.audit_log` |
| `realtime` | `/events` (SSE) | `EventBus.publishAfterCommit(topic, data)` |
| `catalogue` | `/catalogue/categories`, `/qualities`, `/products`, `/skus` | GSM, widths and lengths must be in Settings; HSN/GST optional until Stage 3 (`taxReady`) |
| `suppliers` | `/suppliers`, `/transporters` | `SUP-0001` / `TRN-001` codes; supplier barcode short code derived if blank (ADR-0007) |
| `customers` | `/customers`, `/customers/defaults`, `/customers/:id/credit-policy`, `/customers/:id/block`, `/customer-groups` | Customer scope (group / own customers) enforced in every query (`customer-scope.ts`); new customers inherit salesman defaults, else `credit.defaults` |
| `pricing` | `/customers/:id/rates`, `/customers/:id/rate-history`, `/pricing/bulk-revision[/preview]` | Rates per metre at 44″ (ADR-0013). Overlaps are rejected by the `party_rates_no_overlap` EXCLUDE constraint → 409 `OVERLAP` |
| `salesmen` | `/salesmen`, `/salesmen/:id/default-rates`, `/block`, `/commission-rules`, `/kyc`, `/kyc-documents/:id/file` | Records only — no login (Q10). KYC via `StorageService` (ADR-0023), PDF/PNG/JPEG checked by magic bytes |
| `search` | `/search?q=`, `/dashboard/summary` | Permission- and scope-aware |
| `purchase` | `/purchase-orders`, `/goods-receipts` (`/post`, `/post-over-receipt`), `/purchase-invoices` (`/post`, `/link-grns`, `/landed-cost[/preview]`), `/landed-cost-charges/:id/reverse`, `/purchase-returns` | Rolls are created only when a GRN posts (ADR-0017); over-receipt beyond `purchase.overReceiptTolerancePct` → 422 `APPROVAL_REQUIRED`, then `post-over-receipt` with a reason. Landed cost uses `allocateLandedCost` (largest remainder, ADR-0002); GST never included (ADR-0008). PI lines without a PO line need a reason |
| `inventory` | `/rolls`, `/rolls/:idOrBarcode`, `/rolls/map`, `/rolls/scrap`, `/rolls/:id/length`, `/labels`, `/labels/jobs[/:jobId[/file]]`, `/inventory/stock[/refresh]` | Lookup by id or barcode (scan). Cost fields are hidden without `inventory.view_cost`. Labels render via `@erp/labels` (no cost, ADR-0006); more than 300 go to the worker queue. Stock reads the `mv_stock_*` views, refreshed through `public.refresh_stock_views()` |

## Conventions

- **Edits:** use `updateVersioned` → 409 `VERSION_CONFLICT` on stale writes.
- **Database violations:** unique (23505) and exclusion (23P01) violations become 409 `DUPLICATE` / `OVERLAP`, with a field issue (`common/pg-errors.ts`). Add new constraint names there.
- **Sensitive actions:** `@RequireFreshAuth()` + `@RequireReason()`. The reason travels in `X-Change-Reason` into the audit log.
- **Master codes:** come from `nextMasterCode(tx, companyId, entity)` (`db/master-codes.ts`).
- **Money and rates:** travel as decimal strings. Trim them with `trimDecimal`, never `Number()`.
