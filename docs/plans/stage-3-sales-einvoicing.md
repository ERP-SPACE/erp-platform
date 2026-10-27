# Stage 3 — Sales & E-invoicing: implementation plan

**Status:** approved 2026-10-27 with the default answers below (Q27 pending: owner is arranging sandbox access) · **Branch:** `stage-3-sales-einvoicing` (from `main` after the Stage 2 merge, f42e607)

## What Stage 3 delivers

An order is taken at the right price, checked against the customer's credit, filled with real rolls from the godown (cut if needed), dispatched with a challan, and billed with a GST invoice that carries its IRN — then returned or corrected with credit and debit notes if needed.

**The everyday flow:**

1. **Sales order (SO):** customer, product, width and metres (optionally a length mix, e.g. `3 × 1000 + 2 × 1500`).
   - The rate fills itself: the customer's 44″ rate (or deal rate, or salesman default) × width ÷ 44 (ADR-0013).
   - Changing the rate by more than 5 % needs a Sales Manager or Owner to approve (Q6).
   - **Confirm** runs the credit check: OK → Confirmed; blocked → **OnHold**. A manager can release it with a reason.
2. **Sales Board:** every order as cards in Draft / OnHold / Confirmed / Partial / Closed, with a 44″ price calculator and live stock availability.
3. **Delivery challan (DC) — picking:**
   - The system suggests rolls with the legacy algorithm (oldest full rolls first, then remnants, best fit, swaps), plus **one cut** if the line allows it (ADR-0018).
   - The godown scans the rolls on the phone (`/floor/pick`) or in the office. Each scanned roll is held for this order (Allocated).
   - A cut creates a child roll with its own label and reprints the parent's label.
   - The DC carries the transporter, vehicle no., LR no. and date, distance and e-way bill.
   - **Post DC:** rolls are Dispatched, and the order shows what is still to deliver (backorder).
4. **Sales invoice (SI):** one click from a DC.
   - The preview shows HSN, GST (CGST+SGST in Gujarat, IGST outside), discounts and round-off.
   - **Post:** gets the number `SI/2627/00001` and freezes the invoice. It records each roll's cost (COGS) and the posting event the accounting stage will use.
   - **IRN:** requested from the e-invoice portal right after posting. The final PDF (with the signed QR) prints once the IRN arrives; until then it says "Provisional — IRN pending".
5. **Other routes:**
   - **Direct invoice** (counter / cash sale): SO → SI without a DC. The rolls are scanned on the invoice itself.
   - **Proforma invoice:** own series, no accounting effect; it converts to an SI.
6. **Sales return:** the customer sends back all or part of a roll (e.g. 700 m of 1000 m). The same roll comes back as Returned at 70 % of its cost. It is then inspected: back to stock (new label) or scrap.
7. **Credit note / debit note:** for returns, rate differences and post-invoice discounts. Each one gets its own IRN.
8. **E-way bill:** generated from the IRN when the DC needs one (goods value above ₹50,000), or entered by hand.

## What your invoice R/649 already taught us (built in)

- Lines are **metres × rate per metre**, to the paisa. GST is calculated per rate on the summed taxable value, and the bill is rounded to the rupee with a round-off line. This is already proven in code on R/649 (₹1,56,079.00).
- The SI series starts fresh at `SI/2627/00001` (Q3 update), with no continuation of the R/ series.
- **Sublimation 48099000 @ 18 %**, **Butter 48062000 @ 12 %**; editable per category. An invoice with a category that has no HSN is refused.

## Decisions already made that this stage follows

| Topic | Rule | Source |
|---|---|---|
| Price unit | Per metre at 44″; other widths derived and rounded to 2 decimals | ADR-0013, Q6 |
| Override | > 5 % needs Sales Manager / Owner approval before Confirm | Q6 |
| Credit at Confirm | Outstanding + other open orders + **this order** > limit → OnHold; overdue beyond credit days + 15 grace days → OnHold; rule BOTH by default | ADR-0016, Q7 |
| Roll hold | Only picking onto a draft DC holds a roll; OnHold orders never hold stock | ADR-0014 |
| Cutting | Child roll + new barcode; parent keeps its barcode, shorter; one suggested cut per line; minimum remnant 100 m | ADR-0018 |
| Partial return | Same roll, same barcode, measured length, cost pro-rata, then inspection | ADR-0015 (proposed — see Q19) |
| E-invoice | Mandatory (turnover > ₹5 Cr); IRN via an adapter; NIC sandbox for testing | ADR-0011, Q2 |
| Unregistered / composition buyers | Tax invoice with GST, never a Bill of Supply by default | ADR-0009 (CA confirmation pending, Q18) |

## Build steps (one commit each; you see screens at steps 7 and 9)

1. **Domain (pure logic, ≥ 90 % tested):**
   - SO / DC / SI / proforma / sales-return / CN / DN state machines
   - price resolution: deal rate → party rate → salesman default → none; width derivation; override tolerance check
   - **roll allocation:** the legacy algorithm, ported with characterisation tests copied from legacy behaviour first, then the single-cut step
   - cut maths: child cost, parent's remaining cost, waste (largest remainder)
   - credit exposure and OVER_LIMIT / OVER_DUE / BOTH evaluation
   - invoice engine: line discount, **bill discount spread over lines by value** (largest remainder), GST by state, round-off, COGS
   - partial-return value; e-invoice JSON (NIC schema v1.1) builder and validator
2. **Contracts:**
   - permissions `sales.*`, `sales.override.approve` (step-up), `sales.credit.release` (step-up + reason), `inventory.roll.cut`, `compliance.einvoice.*`
   - settings: allocation standard length and tolerance, minimum remnant, IRN reporting window, e-way bill threshold, invoice PDF options
   - schemas for every endpoint
3. **Database:**
   - sales orders and lines (length mix, `allow_cut`, rate source, override and approval)
   - DCs and DC rolls; `roll_cuts`; `roll_length_adjustments`
   - sales invoices and lines, including **COGS per line**
   - proformas; sales returns
   - credit / debit notes
   - customer sub-ledger view: invoices − credit notes (receipts arrive in Stage 4)
   - e-invoice records (IRN, ack, signed QR, status, attempts)
   - `posting_events` for DC, SI, SR, CN, DN, cut waste
   - a partial unique index so one roll is never on two open returns; audit triggers
4. **API + integration tests:**
   - **SO:** draft → confirm (credit check) → release / hold / close / cancel; allocation preview
   - **DC:** pick and unpick (`FOR UPDATE SKIP LOCKED`), cut, post
   - **SI:** from DC, direct, or from proforma; post with gapless numbering; PDF
   - **proforma:** create → sent → convert
   - **sales return:** post → inspect (scrap or re-stock)
   - CN / DN; the customer's exposure, ledger and aging
5. **E-invoicing (`compliance` module):**
   - `EInvoiceProvider` with the **NIC sandbox**, a manual fallback, and the real GSP added once Q27 is answered
   - IRN generation and cancellation (within 24 h)
   - e-way bill from the IRN
   - worker queue with retries
   - warning on drafts older than 25 days; block beyond the reporting window
6. **Worker:**
   - invoice / DC / CN PDFs (Playwright)
   - IRN retry job
   - credit re-check of OnHold orders after new credit notes or limit changes
7. **Web, office screens:**
   - Sales Board
   - SO form: keyboard-first, rate fills from the 44″ rate, override approval dialog, credit result
   - DC picking with suggestions, scan and cut
   - invoicing screen (preview → post → IRN status)
   - proforma; sales returns + inspection; CN / DN
   - Customer 360 gains Orders, Invoices and Ledger tabs; the dashboard gains sales KPIs
   - **→ screenshots to you for review**
8. **Godown phone app:** `/floor/pick` (scan rolls onto a DC, cut with label print) and `/floor/inspect` (returned rolls).
9. **Gate:**
   - PRD UAT §11.3 and §11.4 (sales return), plus the §11.2 partial-return item deferred from Stage 2, as Playwright tests
   - an IRN generated against the NIC sandbox
   - property tests: bill discount and COGS sum exactly; allocation never double-books a roll
   - performance: credit check < 1 s and scan < 500 ms on 50k seeded rolls
   - axe in light and dark; docs; full run on the isolated stack

## Gate (brief)

- **§11.3:** a 36″ order's rate is derived from the 44″ rate; an override above 5 % opens the approval dialog and the manager's approval confirms it; a credit-blocked customer's order goes OnHold and the exposure includes this order; full SO → DC (transporter, vehicle) → SI with the posting event and correct customer balance; proforma → SI with status Converted and the link back.
- **§11.4 / §11.2:** 700 m of a 1000 m roll returned → credit note at 70 % of the roll's cost → roll Returned → scrapped at the partial cost.
- **IRN:** a B2B invoice gets an IRN and signed QR from the sandbox; the final PDF prints only after that.

## Not in Stage 3

- **Accounting vouchers** (the "auto-voucher" in §11.3 is the self-contained `SI_POSTED` posting event the Accounting stage turns into a voucher) and the GST summary.
- **Receipts, payment allocation and commission** (Stage 4). Until then a customer's outstanding is invoices − credit notes, so **old dues from before go-live are not counted until opening balances are loaded (Stage 6)**.
- WhatsApp sending of invoices (later stage B).

## Questions and answers

The owner approved every default below on 2026-10-27, except Q27 (owner arranging sandbox access) and Q18 (CA, before go-live).

| # | Question | Answer (default approved) |
|---|---|---|
| Q19 | Customer sends back part of a roll: keep the **same roll and barcode** with the shorter length, or give the returned piece a new barcode? | Same roll, same barcode, new label (ADR-0015) |
| Q20 | Discounts: line discount in **%** or **₹**? Is a bill-level discount common? Any cash discount for early payment? | Line % and bill ₹ both available; no cash discount |
| Q21 | Do your invoices to customers carry **freight, packing or loading** charges? | Allowed as extra taxable lines at the goods' GST rate |
| Q22 | Is every dispatch done with a DC, or do counter / cash sales skip it? How often? | Both: DC route and direct invoice |
| Q27 | **E-invoice access:** an existing GSP/ASP (e.g. your accountant's), or direct IRP API registration on einvoice1.gst.gov.in? **Who can give us sandbox credentials?** | NIC sandbox for building; the live provider is plugged in before go-live |
| Q28 | Cutting: is there trim waste per cut? Smallest piece worth keeping (100 m)? Customers who never accept cut rolls? | No waste by default; 100 m minimum; `allow_cut` per customer |
| Q29 *(new)* | One invoice per DC, or can one invoice cover **several DCs** of the same customer? | One SI can cover several open DCs of the same customer |
| Q30 *(new)* | Should the invoice PDF copy the **layout of R/649** (your current bill), or use a fresh clean layout with the same information? | Same information and order as R/649, cleaner design |
| Q18 | **CA, re-raised:** GST out of landed cost; tax invoice for unregistered / composition buyers; TCS reserved; SEZ with LUT. | Built as listed, each switchable; must be confirmed before go-live |
