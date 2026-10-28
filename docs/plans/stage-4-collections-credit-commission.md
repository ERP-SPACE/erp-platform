# Stage 4 — Collections, Credit & Commission: implementation plan

**Status:** approved 2026-10-28 with the default answers below · **Branch:** `stage-4-collections` (from `main` after the Stage 3 merge, b4b9c33)

## What Stage 4 delivers

Money comes in and goes out against the right invoices; everyone can see who owes what and for how long; credit holds react to payments by themselves; and salesmen's commission is earned, reversed and paid from real documents instead of a spreadsheet.

**The everyday flow:**

1. **Receipt from a customer:** date, mode (Cash, NEFT, RTGS, UPI, Cheque), amount, reference (UTR / cheque no. and bank).
   - The screen lists the customer's open invoices, oldest first, and **suggests** allocating the money to them in that order. The accountant can change any amount.
   - Anything not allocated stays **on account** (an advance), flagged until it is used.
   - Posting it: the invoices' outstanding drops, aging updates, held orders are re-checked (Stage 3 job), and `ON_PAYMENT_RECEIVED` commission accrues.
2. **Using on-account money later:** allocate an earlier advance or an unused credit note to new invoices, without a new receipt.
3. **Cheque bounce:** reverse a posted cheque receipt with a reason. Its allocations are undone, the invoices are outstanding again, any commission it triggered is reversed, and the customer's credit is re-checked. (Q23)
4. **Payment to a supplier:** the same as a receipt, against posted purchase invoices, with debit notes from purchase returns usable as credits.
5. **Statements:** a customer or supplier statement for a date range (opening balance, every document and payment, closing balance, aging), on screen and as a PDF.
6. **Aging:** AR and AP aging by customer / supplier in **0–30, 31–60, 61–90, 90+ days** past the invoice date (PRD §9), with drill-down to the invoices.
7. **Credit control:**
   - Exposure stays live (Stage 3). It now subtracts receipts and counts challans dispatched but not yet invoiced.
   - A **nightly job** re-evaluates every customer: overdue beyond credit days + grace → blocked (if auto-block is on); once paid down → **unblocked automatically**, with the reason recorded.
   - **Blocked-orders view:** held orders with the reason, exposure and the last receipt; Owner / Sales Manager release with a reason and password (as now).
8. **Commission:**
   - Accrual entries per document, from the customer's rule in force on the invoice date:
     - `ON_SI_POSTED`: accrues on posting; a credit note against the invoice reverses its share automatically, with the reason.
     - `ON_PAYMENT_RECEIVED`: accrues in proportion to each payment allocated to the invoice (pro-rata, Q24); a bounced cheque reverses it.
   - Base: `PERCENT_SALES` on taxable value (Q11); `PER_METER` on billed metres.
   - **Payout batch:** pick a salesman and period → the accrued entries → mark paid with the payment reference. Paid entries are locked; a later reversal becomes a negative entry in the next batch.
   - Commission statement per salesman.
9. **Posting events** for receipts, payments, allocations, bounces, discounts and commission accrual / payout, so the Accounting stage can turn them into vouchers.

## Decisions built in

| Topic | Decision | Source |
|---|---|---|
| Allocation | Against specific invoices; suggested oldest first (FIFO by due date); editable; unallocated = on account and flagged | PRD §8, brief |
| Partial payment | Allowed; an invoice is Paid only when its outstanding is zero | PRD |
| Aging basis | Days past the **invoice date**, buckets from a new setting `ar.agingBuckets` (default 30/60/90). Credit-overdue uses the **due date** (credit days + grace), as in Stage 3 | PRD §9, ADR-0016 |
| Exposure | Outstanding invoices − unapplied credits (on-account receipts, unused credit notes) + **dispatched-not-invoiced challans** + uninvoiced value of Confirmed / PartiallyFulfilled orders; OnHold orders are excluded | Brief gate; fixes a Stage 3 gap (a dispatched, uninvoiced challan currently drops out of exposure) |
| Auto-unblock | Only blocks the system placed (overdue / over-limit); a manual block is lifted only by a person | PRD §5.5 |
| Receipts are immutable | Posted receipts are never edited: correct by reversing (bounce / mistake, with reason) and re-entering | CLAUDE.md rule 1 |
| Numbers | `RC/2627/00001` receipts, `PY/2627/00001` payments, `CP/2627/00001` commission payouts (ADR-0003 series) | ADR-0003 |
| Salesman on a document | The invoice's salesman is the order's salesman, else the customer's default salesman; frozen at posting | PRD §5.6 `is_default` |

## Build steps (one commit each, local until you approve the push)

1. **Domain** (`packages/domain`, pure, ≥ 90 % coverage):
   - `suggestAllocation(amount, openInvoices)` — FIFO by due date, largest-remainder paise, never over-allocates an invoice
   - `invoiceOutstanding`, `agingBuckets(asOf, items, buckets)`
   - `commissionFor(rule, document)` and `paymentShare(allocation, invoiceTotal)` for pro-rata accrual, with reversals that net exactly to zero
   - receipt and payout state machines (Draft → Posted → Reversed; payout Draft → Paid)
   - property tests: allocations never exceed the receipt or any invoice; accrual − reversals = 0 after a full credit note or bounce
2. **Contracts:** receipt / payment / allocation / statement / aging / commission DTOs; permissions `collections.receipt.manage`, `collections.receipt.reverse` (step-up + reason), `payables.payment.manage`, `commission.payout.manage`, `reports.aging.view`; settings `ar.agingBuckets`, `collections.suggestFifo`, `credit.nightlyCheckTime` (default 02:00 IST).
3. **Database:** `receipts`, `payments`, `allocations` (receipt or credit note or debit note → invoice), `commission_entries` (accrued / reversed / paid, source document), `commission_payouts`; partial indexes for open invoices; audit triggers; `v_customer_ledger` / new `v_supplier_ledger` updated to include receipts and payments.
4. **API:**
   - receipts and supplier payments: create, suggest allocation, post, reverse (bounce), allocate on-account / credit notes later
   - ledgers and statements (customer and supplier, date range), AR / AP aging, blocked-orders view
   - credit service counts receipts and dispatched challans; Stage 3 credit re-check triggered by receipts and reversals
   - commission accrual hooks on SI post, CN post, receipt post / reverse; payout batches; salesman statement
   - posting events for every financial command
   - integration tests for each, including UAT §11.5 (receipt) and §11.6
5. **Worker:**
   - nightly credit evaluation (block / unblock, logged) at the configured time
   - statement PDFs (customer, supplier, salesman commission) through the Stage 3 document pipeline
6. **Web, office screens:**
   - Collections section: receipts list, new receipt (invoice table with suggested allocation, keyboard-first), receipt page (allocations, reverse)
   - Payables: supplier payments the same way
   - AR and AP aging (bucket columns, drill-down), statements with PDF
   - Blocked orders board; Customer 360 gains Receipts and a live Statement tab; Salesman page gains Commission (accruals, payouts, statement)
   - Dashboard / Sales Board: today's collections, overdue total, aging bar
   - **→ screenshots to you for review**
7. **Gate:**
   - PRD UAT §11.5 receipt item: post a receipt → allocate to 2 invoices → AR aging updated and unallocated balance = 0 (Playwright)
   - PRD UAT §11.6: `ON_SI_POSTED` accrues on posting; a credit note reverses it with the reason (Playwright)
   - exposure includes Confirmed / PartiallyFulfilled order value and excludes OnHold (integration)
   - property tests above; performance: aging on 50k rolls + 20k invoices < 1 s; axe light and dark; docs; full isolated run

## Gate (brief)

- **§11.5 (receipt):** post a receipt → allocate to 2 invoices → AR aging updated and the unallocated balance is zero.
- **§11.6:** commission `ON_SI_POSTED` accrues when the SI posts; a credit note against it creates the reversal entry automatically with `reversal_reason` filled.
- **Exposure:** includes Confirmed / PartiallyFulfilled SO value, excludes OnHold.
- The other §11.5 items (PI / SI vouchers, GST summary) belong to the Accounting stage: the posting events they will consume are already tested.

## Gate results (2026-10-28)

| Check | Result |
|---|---|
| PRD UAT §11.5 in the browser (`e2e/stage4.gate.spec.ts`) | Pass: three invoices of ₹8,260; a ₹16,520 NEFT receipt applied "Oldest first" to two of them, posted; aging drops to ₹8,260; nothing left on account or unused |
| PRD UAT §11.6 in the browser | Pass: 1 % `ON_SI_POSTED` accrues ₹70 per invoice; a ₹1,000 + GST credit note posted from `/sales/notes/new` creates the ₹10 reversal entry with the note's reason |
| Bounce and payout | Pass: a cheque reversed as bounced from the receipt page re-opens the invoice (₹7,080); a commission payout of ₹200 is paid with ₹10 TDS, numbered CP, net ₹190 |
| API integration tests | 93 pass (collections included) |
| Domain tests | 115 pass, coverage 99.7 % |
| Accessibility (axe, WCAG 2.1 A/AA) | Pass in light and dark: receipts, payments, both new forms, aging, blocked orders, commission, a receipt, a statement, a payout |
| Full isolated E2E run (`pnpm test:e2e:isolated`, Stages 0–4) | 114 pass |

Open: Q31 (allocation swap overshoot) is still waiting for the owner.

## Not in Stage 4

- Vouchers, chart of accounts, GST summary, bank reconciliation (Accounting stage; posting events are written now).
- Interest on overdue invoices, unless Q23 says it is charged today.
- Reports beyond aging and statements (Stage 5); opening balances for old dues (Stage 6 — until then outstanding covers only documents made in the ERP).
- Sending statements / reminders on WhatsApp (later stage B); email can come later too.

## Questions and answers

The owner approved every default below on 2026-10-28 (Q31 stays open).

| # | Question | Default |
|---|---|---|
| Q23 | Advances / on-account receipts and cheque bounces: how are they handled today? Is interest charged on late payment? | Advances kept on account and used against later invoices; a bounce reverses the receipt with a reason (and can carry a bank-charge debit note); **no interest** |
| Q24 | `ON_PAYMENT_RECEIVED`: should partial payments earn commission pro-rata? | **Yes, pro-rata** to the taxable part of each payment |
| Q32 | Do customers deduct **TDS** (e.g. 0.1 % under s.194Q) or round off when paying? | A receipt line can carry a TDS / short-payment amount that settles the invoice without being cash; recorded separately for the CA |
| Q33 | Who may record receipts and supplier payments, and does a supplier payment need the Owner's approval? | Accounts role records both; supplier payments above a setting (default ₹5,00,000) need Owner approval with password |
| Q34 | Commission payouts: monthly per salesman? Paid in cash or bank? Is TDS deducted on commission? | Monthly batches; mode and reference recorded; TDS amount optional on the batch |
| Q35 | Should the nightly job **unblock** customers automatically once they pay, or only tell a manager? | Unblock automatically for system blocks; manual blocks stay until a person lifts them |
| Q31 | (open from Stage 3) Cap roll-suggestion swaps at the tolerance? | Keep legacy behaviour |
