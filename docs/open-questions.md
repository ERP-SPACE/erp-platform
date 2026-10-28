## Answered

| # | Question | Answer (2026-10-23) | Effect |
|---|---|---|---|
| Q2 | Turnover above ₹5 Cr? | **Yes** | E-invoicing (IRN) is mandatory and moves into Stage 3 — ADR-0011 accepted |
| Q3 | Number format | Delegated to engineering | `{TYPE}/{FY}/{SEQ5}`, e.g. `SI/2627/00001` — ADR-0003 |
| Q4 | Infrastructure | Local first, AWS later; new repo in `ERP-SPACE`, name delegated | Monorepo `ERP-SPACE/erp-platform`; Docker Compose locally; AWS becomes Stage 7 — ADR-0019 |
| Q5 | Per metre or per roll? | **Per metre** | ADR-0013 accepted |
| Q17 | Are rolls ever cut? | **Sometimes** | Cut operation, child rolls, cut-aware allocation — ADR-0018 |
| Q6 | Rate rounding, override tolerance, approver | **2 decimals; > 5 % needs Sales Manager or Owner** | Settings `pricing.rateDecimals` / `pricing.overrideTolerancePct`; permission `pricing.override.approve` (used from Stage 3) |
| Q7 | Default credit policy | **₹1,00,000, 30 days, 15 grace days, block on BOTH** | Setting `credit.defaults`; a salesman's own defaults override it |
| Q8 | Master lists | **GSM 30/35/45/55/65/80/100; widths 24/36/44/63; lengths 1000/1500/2000 m; Premium/Standard/Economy**, extended 2026-10-27 from real invoices: GSM 29, widths 40/46/48/50/60, lengths 720–1300 m, quality Eco | Seeded into Settings and the catalogue |
| Q9 | HSN / GST per category | **Entered later in the app** | Categories start "HSN not set"; Stage 3 refuses to invoice them |
| Q10 | Do salesmen log in? | **No — office staff enter everything** | Salesmen are records only, no user accounts |
| Q11 | Commission base | **Taxable value** (after discounts, before GST) | `PERCENT_SALES` rules; accrual in Stage 4 |
| Q1 | Company GST profile | **Gulmohar Creation**, GSTIN 24AAOFG2101Q1ZB, Hojiwala Industrial Estate, Surat 394230 (from invoice R/649, 2026-10-27) | Seeded as the company profile; bank and signatory to be added in Settings |
| Q9 (update) | HSN / GST per category | **Sublimation 48099000 @ 18 %** (seen on all invoices); **Butter (greaseproof) 48062000 @ 12 %** (owner, 2026-10-27). Must stay editable | Seeded; editable in Catalogue |
| Q3 (update) | Invoice series | **Start with the ERP's own series** (`SI/2627/00001`), not the old R/ series (2026-10-27) | ADR-0003 unchanged |
| Q13 | Measure each roll at inward? | **No — trust the supplier's lengths** (suppliers list them, e.g. "4 X 1000, 500+450 MTRS") | GRN takes the supplier's per-roll lengths; no re-measure step |
| Q15 | Godown locations? | **Not tracked today** | No location fields in Stage 2; can be added later |
| Q16 | Landed-cost split | **Delegated to engineering**: follow the common trade structure; must stay editable | Built: setting `purchase.landedCostCharges` — freight and loading by weight (GSM × width × length), insurance, duty, clearing, brokerage and other by value; the split can be changed per charge on each invoice |
| Q19 | Partial return: same roll or new barcode? | **Same roll, same barcode, measured length, new label (ADR-0015 accepted)** (owner approved the default, 2026-10-27) | Stage 3 plan |
| Q20 | Discount practice | **Line discount in %, bill discount in ₹ (spread over lines by value); no cash discount** (owner approved the default, 2026-10-27) | Stage 3 plan |
| Q21 | Extra charges on customer invoices? | **Freight / packing / loading allowed as extra taxable lines at the goods' GST rate** (owner approved the default, 2026-10-27) | Stage 3 plan |
| Q22 | Every dispatch via a DC? | **Both: DC route and direct invoice for counter sales** (owner approved the default, 2026-10-27) | Stage 3 plan |
| Q28 | Cutting defaults | **No trim waste by default (can be entered per cut); 100 m minimum remnant; `allow_cut` per customer** (owner approved the default, 2026-10-27) | Stage 3 plan |
| Q29 | One SI per DC or several DCs? | **One SI can cover several open DCs of the same customer** (owner approved the default, 2026-10-27) | Stage 3 plan |
| Q30 | Invoice PDF layout | **Same information and order as R/649, in a cleaner layout** (owner approved the default, 2026-10-27) | Stage 3 plan |
| Q23 | Advances, bounces, interest | **Advances kept on account and used against later invoices; a bounce reverses the receipt with a reason; no interest** (owner approved the default, 2026-10-28) | Stage 4 plan |
| Q24 | Pro-rata commission on partial payment | **Yes, pro-rata** (owner approved the default, 2026-10-28) | Stage 4 plan |
| Q32 | TDS / short payment by customers | **A receipt line can carry TDS or a short-payment amount that settles the invoice without cash** (owner approved the default, 2026-10-28) | Stage 4 plan |
| Q33 | Receipts / supplier payments | **Accounts role records both; supplier payments above ₹5,00,000 need the Owner's approval with password** (owner approved the default, 2026-10-28) | Stage 4 plan |
| Q34 | Commission payouts | **Monthly batches; mode and reference recorded; optional TDS on the batch** (owner approved the default, 2026-10-28) | Stage 4 plan |
| Q35 | Nightly credit job | **Unblock automatically for blocks the system placed; manual blocks stay** (owner approved the default, 2026-10-28) | Stage 4 plan |

## Deferred by owner

| # | Question | Default being built | Linked |
|---|---|---|---|
| Q18 | **CA:** (a) GST kept out of landed cost, (b) tax invoice — not Bill of Supply — for unregistered/composition buyers, (c) TCS flag reserved only, (d) any SEZ customers? | (a) excluded, (b) tax invoice, (c) reserved flag, (d) SEZ supported with an LUT reference. Each is switchable in Settings. **Must be confirmed before go-live.** | ADR-0008/9/10 |

## Before Stage 0 (foundation)

| # | Question | Why it matters | Linked |
|---|---|---|---|
| Q4a | Install on this machine: **GitHub CLI** (`gh auth login` with access to `ERP-SPACE`) and **Docker Desktop**. Alternatively, create the empty private repo `ERP-SPACE/erp-platform` yourself. | Repo creation and local Postgres/Redis. | ADR-0019 |

## Before Stage 2 (purchase & inventory)

| # | Question | Why it matters | Linked |
|---|---|---|---|
| Q12 | *(Default built; confirm when hardware is bought.)* Hardware: thermal label printer (TSC/Zebra 4″) + USB scanner? Label size (default 100×50 mm)? Android phones in the godown? | Labels carry each roll's barcode/QR and are stuck on at GRN. Owner unsure of hardware (2026-10-27): **default PDF labels 100×50 mm, printable on any printer; a thermal printer (ZPL) can be switched on later in Settings** | ADR-0006/7 |
| Q14 | Does the supplier invoice ever arrive before the goods (PI before GRN)? | *Built both ways:* a PI can be posted first and its GRNs linked later; rolls take the PI rate when linked. Confirm this matches practice. | ADR-0017 |

## Before Stage 3 (sales)

| # | Question | Why it matters | Linked |
|---|---|---|---|
| Q27 | *(Owner arranging sandbox access, 2026-10-27.)* **E-invoice access:** use an existing GSP/ASP (e.g. the one your accountant uses for GST filing), or register for direct IRP API access on einvoice1.gst.gov.in? We need sandbox credentials for testing. | IRN integration in Stage 3. | ADR-0011 |

| Q31 *(new, from the Stage 3 gate)* | **Roll suggestions may overshoot.** The legacy allocation keeps its "swap for a slightly longer roll" step, ported unchanged: e.g. 51 m still needed and a 152 m roll in stock → it suggests the 152 m roll. Suggestions are only advice (the godown scans what it sends), but should a swap be capped at the tolerance (100 m over)? | Default: keep the legacy behaviour; a cap is a one-line change in `packages/domain/src/allocation.ts`. | Port matrix 2.1 |

## Before Stage 6 (go-live)

| # | Question | Why it matters | Linked |
|---|---|---|---|
| Q25 | Where do opening balances come from: Tally export, spreadsheets? Is a roll-by-roll stock list possible? | Opening Balance Wizard importers. | PRD §5.10 |
| Q26 | Target go-live date? | Plan, UAT, training. | — |
