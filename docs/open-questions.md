# Open Questions

Owner: business owner, unless marked **CA**. Each question is tagged with the stage it blocks. When a question is answered, move it to **Answered** and update or accept the linked ADR.

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
| Q16 | Landed-cost split | **Delegated to engineering**: follow the common trade structure; must stay editable | Default basis per charge type in Settings (Stage 2) |

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
| Q12 | Hardware: thermal label printer (TSC/Zebra 4″) + USB scanner? Label size (default 100×50 mm)? Android phones in the godown? | Labels carry each roll's barcode/QR and are stuck on at GRN. Owner unsure of hardware (2026-10-27): **default PDF labels 100×50 mm, printable on any printer; a thermal printer (ZPL) can be switched on later in Settings** | ADR-0006/7 |
| Q14 | Does the supplier invoice ever arrive before the goods (PI before GRN)? | PI/GRN ordering rules. | ADR-0017 |

## Before Stage 3 (sales)

| # | Question | Why it matters | Linked |
|---|---|---|---|
| Q19 | Partial returns: keep the same roll and barcode with an updated length (proposed), or create a new child roll? | Roll lineage + labels. | ADR-0015 |
| Q20 | Discount practice: line discount as % or ₹? Is a bill-level discount common? Any cash discount for early payment? | Invoice engine. | PRD §8.2 |
| Q21 | Do invoices carry extra charges (freight, packing, loading) billed to the customer? | Extra taxable lines on the SI and in the e-invoice. | — |
| Q22 | Is every dispatch a DC, or do counter/cash sales skip the DC? How often? | Flow priority. | PRD §6.5 |
| Q27 | **E-invoice access:** use an existing GSP/ASP (e.g. the one your accountant uses for GST filing), or register for direct IRP API access on einvoice1.gst.gov.in? We need sandbox credentials for testing. | IRN integration in Stage 3. | ADR-0011 |
| Q28 | Cutting: is there usually trim waste per cut? What is the smallest piece worth keeping in stock (default 100 m)? Do some customers never accept cut rolls? | Cut defaults and `allow_cut` per customer. | ADR-0018 |

## Before Stage 4 (collections, credit, commission)

| # | Question | Why it matters | Linked |
|---|---|---|---|
| Q23 | Advances / on-account receipts and cheque bounces: how are they handled today? Is any interest charged on overdue amounts? | Receipt + allocation design. | PRD §5.9 |
| Q24 | With commission `ON_PAYMENT_RECEIVED`, should partial payments accrue commission pro-rata? | Commission accrual. | PRD §5.6 |

## Before Stage 6 (go-live)

| # | Question | Why it matters | Linked |
|---|---|---|---|
| Q25 | Where do opening balances come from: Tally export, spreadsheets? Is a roll-by-roll stock list possible? | Opening Balance Wizard importers. | PRD §5.10 |
| Q26 | Target go-live date? | Plan, UAT, training. | — |
