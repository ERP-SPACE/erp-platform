# 0004 — Posting events outbox (accounting deferred, nothing lost)

- **Status:** Accepted
- **Date:** 2026-10-23

## Context
Accounting (CoA, vouchers, GST summary) is deferred to a later stage. But PRD KPI #4 demands 100% auto-voucher coverage, and receivables and credit control are needed now.

## Decision
- **The table:** every financially relevant command writes an immutable row to `posting_events`, in the same transaction:
  - `type`, `doc_type`, `doc_id`, `doc_no`, `doc_date`, `party`
  - `payload` (jsonb): taxable value, discounts, CGST/SGST/IGST per rate, round-off, COGS per roll, landed-cost components, HSN
  - `schema_version`
- **Event types:** PI_POSTED, SI_POSTED, DC_POSTED, RECEIPT_POSTED, PAYMENT_POSTED, SALES_RETURN_POSTED, PURCHASE_RETURN_POSTED, ROLL_SCRAPPED, LANDED_COST_ALLOCATED, LANDED_COST_VARIANCE, BILL_DISCOUNT_APPLIED, OPENING_BALANCE.
- **Customer/supplier balances** (sub-ledger: invoices, receipts, allocations, notes) are built now as operational tables, not vouchers.
- **Later:** the accounting stage consumes events in order and back-fills vouchers for all history.
