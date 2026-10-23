# Legacy Port Matrix

Source: `../erp_api` (Express + Mongoose) and `../erp_web_app` (CRA + MUI). These are read-only, test data only, and nothing is migrated.

**Verdicts**
- **Keep:** port the behaviour as-is into `packages/domain` with characterisation tests.
- **Improve:** port the idea and fix the listed gaps.
- **Replace:** follow PRD v2 instead. The legacy is wrong, weak, or superseded.
- **Defer:** belongs to a later stage (Accounting or WhatsApp).

## 1. Pricing & rates

| # | Capability | Legacy reference | Verdict | Notes for the new build |
|---|---|---|---|---|
| 1.1 | 44″ → width derivation | `services/pricingService.js` `calculateSalesPricing`, `calculateWidthRate` | **Improve** | Two inconsistent roundings exist: 2 decimals in `calculateSalesPricing`, nearest ₹1 in `calculateWidthRate`. Use one `deriveRate()` in `packages/domain/pricing.ts` with configurable precision. |
| 1.2 | **Price unit is per metre** | `calculateSalesPricing`: `lineTotal = totalMeters × finalRate` | **Keep** | Owner confirmed per metre (ADR-0013). |
| 1.3 | Benchmark lookup via the product's 44″ SKU | `salesOrderController.js` `getBenchmarkSkuForSalesSku`, `getBenchmarkRate44ForCustomer` | **Keep** | The rate is keyed by (customer, product), not SKU. That's correct, because the width is derived. |
| 1.4 | Polymorphic `BaseRate` (supplier / agent / customer rates on one model) | `models/BaseRate.js` | **Improve** | Split into `party_rates` (customer, with PRD validity ranges and no overlap), `salesman_default_rates`, and `supplier_rates` (purchase reference price). Legacy has **no validity dates**, only one live rate per pair. |
| 1.5 | Rate history | `models/RateHistory.js` (stores only `previousRate`) | **Replace** | Use PRD §5.5 Rate History: effective rate, override flag, by, reason, source SO/SI. |
| 1.6 | Bulk rate revision (PERCENTAGE / FLAT) | `pricingService.bulkRateRevision` | **Improve** | Keep both modes. Add scope by customer group / product family (PRD), a preview step, one transaction, and history rows. Legacy writes row-by-row with no transaction. |
| 1.7 | Deal rate as % off the whole order | `pricingService.calculateDealRate` | **Improve** | PRD stores `agreed_rate_44` per SO (optionally per product/SKU). Keep "% off" as an input helper that computes the agreed rate. |
| 1.8 | Override tolerance (hard-coded 5%) | `pricingService.applyOverrideRate` | **Improve** | Move to Settings; approval flow with step-up auth. |

## 2. Sales

| # | Capability | Legacy reference | Verdict | Notes |
|---|---|---|---|---|
| 2.1 | **Roll allocation algorithm** | `services/allocationService.js` | **Keep** | Steps: (1) FIFO full-length rolls, (2) longest remnants, (3) greedy fit without cutting rolls, (4) swap optimisation when shortfall ≤ tolerance, (5) group by length. Ahead of the PRD. Port as a pure function; standard length (1000 m) and tolerance (100 m) become Settings. Used for the SO preview and the DC pick suggestion. **Extended with a single-cut suggestion step**, because rolls are sometimes cut (ADR-0018). |
| 2.2 | Allocation preview endpoint (no save) | `salesOrderController.previewAllocation` | **Keep** | Feeds the pricing/allocation pane on the Sales Board. |
| 2.3 | **SO line "bifurcations"** (length mix per line, e.g. 3 × 1000 m + 2 × 1500 m) | `SalesOrders.js` bifurcation dialog; `buildProcessedLine` | **Keep** | Not in the PRD but matches how paper is actually ordered. SO line = total metres + optional length mix + roll count (ADR-0012). |
| 2.4 | Credit check on confirm | `runCreditCheckForSalesOrder` | **Improve** | Legacy includes **this order's value** in exposure (good, so kept — ADR-0016). Legacy has **no OVER_DUE / grace-day rule** and ignores `blockRule` and `autoBlock`. Implement PRD §8.5 fully. |
| 2.5 | Re-check OnHold SO and release | `recheckSalesOrderCredit` | **Keep** | |
| 2.6 | SO hold / close / cancel | `holdSalesOrder`, `closeSalesOrder`, `cancelSalesOrder` | **Replace** | Legacy allows them from **any** state (e.g. closing a Draft, holding a Closed SO). Use the explicit state machine. |
| 2.7 | DC: roll must be Mapped/Allocated; SO dispatched qty; SO auto Closed/PartiallyFulfilled | `deliveryChallanController.js` | **Improve** | Logic is right, but there is no row locking (two DCs can take one roll) and no transaction. Add `FOR UPDATE SKIP LOCKED` and a transaction. The DC lifecycle is in ADR-0014. |
| 2.8 | DC vehicle number | `deliveryChallanController` (`vehicleNumber`) | **Improve** | Add the transporter FK, LR number, and e-way bill number/date (ADR-0011). |
| 2.9 | SI line maths (`ratePerRoll`, line % discount, tax-inclusive `lineTotal`, reverse-calc from total) | `erp_web_app/src/utils/salesLinePricing.js`, `salesInvoiceController.js` | **Replace** | Legacy floats, back-calculates rates from tax-inclusive totals, and has no bill-level discount allocation or GST split by state. Use the domain invoice engine (PRD §8.2, §8.6) shared by web and API. |
| 2.10 | Duplicate-return guard (a roll can't be on two open returns) | `salesReturnController.js` L130–140, `purchaseReturnController.js` L132–138 | **Keep** | Enforce with a DB partial unique index as well. |
| 2.11 | COGS stored per SI line | `salesReturnController` uses `siLine.cogsAmount` | **Keep** | Persist COGS per SI line at posting. It is needed for partial-return COGS and margin reports. |

## 3. Purchase & inventory

| # | Capability | Legacy reference | Verdict | Notes |
|---|---|---|---|---|
| 3.1 | **Rolls created at both GRN and PI posting** | `grnController.js` L112–129, `purchaseInvoiceController.createRollsForPurchaseInvoice` | **Replace (bug)** | Can create duplicate rolls for the same goods. PRD: rolls and barcodes are created at **GRN posting only**; the PI links to existing rolls. |
| 3.2 | **Landed cost applied twice** | `createRollsForPurchaseInvoice` adds `totalLandedCost` overhead at creation, and `allocateLandedCost` adds it again | **Replace (bug)** | Use the PRD allocator: per component, ROLL/METER/VALUE basis, largest remainder, preview, variance for dispatched rolls. Legacy supports METER only. |
| 3.3 | Per-roll actual lengths on inward (`rollDetails`) | `purchaseInvoiceController` `normalizeRollDetails`, `deriveRollMetrics` | **Keep** | Capture at GRN: a line of N rolls can have varying actual lengths. |
| 3.4 | Roll fields beyond PRD: `originalLength` / `currentLength`, `baseCostPerMeter`, `landedCostPerMeter` + total, `warehouseLocation {zone, rack, bin}`, `inwardedAt`, `mappedAt` | `models/Roll.js` | **Keep** | Per-metre cost makes partial-length COGS exact. Location is useful even with one godown (pick lists). |
| 3.5 | Bulk map Unmapped → SKU in one transaction (GSM/quality resolved by name) | `rollService.mapUnmappedRolls` | **Keep** | Add inline SKU creation (PRD) and the `mapped_at` age metric. |
| 3.6 | Partial return → original roll zeroed + **new child roll** for the remaining metres (min 100 m), straight to Mapped | `rollService.handleReturn` | **Improve** | Skips the PRD inspection step. Decision in ADR-0015. |
| 3.7 | Scrap without a cost entry | `rollService.markAsScrap` | **Improve** | Requires a reason. Write a `ROLL_SCRAPPED` posting event at landed cost. |
| 3.8 | Barcode `YYMM-SUP-BATCH-SEQ-CHECK` | `models/Roll.js` pre-save hook | **Improve** | Format kept. The check digit is ASCII-sum mod 10, which misses transpositions; switch to Luhn mod-36. SEQ comes from `countDocuments`, which races; use a locked per-batch counter. QR already excludes cost (good — ADR-0006). |
| 3.9 | Batch code `BATCH-YYMM-<random 3 digits>` | `numberingService.generateBatchCode` | **Replace** | A random suffix can collide. Use a per-supplier sequence, unique per supplier (PRD). |
| 3.10 | Inventory summary aggregation | `rollService.getInventorySummary` | **Replace** | Becomes a materialized view refreshed every 3 min. |
| 3.11 | PO ↔ PI line matching by key | `purchaseInvoiceController` `buildPoLineKey`, `resolvePoLineIdForInvoice` | **Keep** | Useful when a PI arrives without explicit line ids. A PI without a PO line requires a reason (PRD). |

## 4. Parties, salesmen, commission

| # | Capability | Legacy reference | Verdict | Notes |
|---|---|---|---|---|
| 4.1 | Customer extras: PAN, billing address + **multiple shipping addresses** (default flag), referral {source, name, contact, company, remarks}, businessType, onboardedBy/At | `models/Customer.js` | **Keep** | Shipping address matters for place of supply and e-way bills. |
| 4.2 | Contact persons with exactly one primary | `customerController.sanitizeContactPersons` | **Keep** | Use a DB partial unique index on `(customer_id) WHERE is_primary`. |
| 4.3 | Customer groups as a master table, many per customer | `models/CustomerGroup.js`, `normalizeCustomerGroupIds` | **Keep** | Seed Cash, Wholesale, Big. |
| 4.4 | Manual block flag + reason + unblockedBy | `Customer.creditPolicy.isBlocked` | **Keep** | Alongside auto-block. Stored `currentExposure` is dropped (compute it live). |
| 4.5 | Customer ↔ salesman mapping sync | `customerService.syncAgentCustomerMapping` | **Keep** | Becomes a FK + the `is_default` commission rule. |
| 4.6 | Codes `CUST-0001`, `SUP-0001` | `numberingService` | **Keep** | Via the sequence table. |
| 4.7 | Salesman KYC documents with type + notes | `models/Agent.js` | **Keep** | S3 presigned upload. |
| 4.8 | Party commission (per metre / %) with dated history, `applyByDefault`, change log (changedBy, previous/new values) | `models/Agent.js`, `services/agentService.js` | **Improve** | Add PRD `trigger_event` and validity, and **per-document accrual entries** (legacy only has manual period payouts). |
| 4.9 | Payouts (period, amount, pending/paid/on_hold, payment reference) | `Agent.commissionPayouts` | **Improve** | A payout batch settles specific accrual entries. |
| 4.10 | Salesman default product rates for newly onboarded customers | `agentService` `normalizeDefaultSkuRates`, `resolveDefaultSkuRatesToProducts` | **Keep** | Keyed by product (not SKU). Legacy already migrated from SKU to product. |

## 5. Platform

| # | Capability | Legacy reference | Verdict | Notes |
|---|---|---|---|---|
| 5.1 | Document numbering (regex-max + 1; two formats) | `services/numberingService.js` | **Replace** | Not concurrency-safe, no FY config. Use gapless `document_sequences` (ADR-0003). |
| 5.2 | Roles enum + permissions {modules, customerGroups, productCategories} | `models/User.js`, `middlewares/auth.js` | **Improve** | Keep the scoping idea (group/category). Move to permission-based RBAC with query-layer enforcement. |
| 5.3 | Request-level audit with secret redaction | `middlewares/auditMiddleware.js` | **Improve** | Keep the redaction key list. Capture via DB triggers with before/after rows (PRD §12). |
| 5.4 | Vouchers and ledgers with stored running balances (`applyLedgerDelta`) | `voucherController.js`, `salesReturnController.ensureSalesReturnVoucher` | **Defer** | Accounting stage. Never store running balances; derive them from voucher lines. |
| 5.5 | WhatsApp config on the customer (number, language) | `Customer.whatsappConfig` | **Keep** | Add a consent timestamp and source. |
| 5.6 | Frontend (MUI pages, 26k lines) | `erp_web_app/src/pages/**` | **Replace** | New Editorial Ledger UI. Carry over UX ideas: the bifurcation dialog, allocation preview, Enter-to-next-field in line grids (`SalesOrders.js` L1397, `PurchaseOrders.js` L1155). |

## 6. Legacy weaknesses fixed by the new architecture (not ported)

- Multi-document writes outside transactions (DC posting, landed cost, bulk rate revision).
- JS floats for money throughout.
- No idempotency: legacy relies on a status-filtered `findOneAndUpdate` in the PI post only.
- No optimistic concurrency.
- Widths hard-coded as `enum: [24, 36, 44, 63]` in the Roll model and PI controller. These move to Settings.
