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

## Deferred by owner

| # | Question | Default being built | Linked |
|---|---|---|---|
| Q18 | **CA:** (a) GST kept out of landed cost, (b) tax invoice — not Bill of Supply — for unregistered/composition buyers, (c) TCS flag reserved only, (d) any SEZ customers? | (a) excluded, (b) tax invoice, (c) reserved flag, (d) SEZ supported with an LUT reference. Each is switchable in Settings. **Must be confirmed before go-live.** | ADR-0008/9/10 |

## Before Stage 0 (foundation)

| # | Question | Why it matters | Linked |
|---|---|---|---|
| Q1 | Company GST profile: legal & trade name, GSTIN, registered address, state, PAN, bank details, logo, authorised signatory. **Still needed — not blocking:** Stage 0 seeds placeholders that are editable in Settings. | Invoice letterhead, intra- vs inter-state GST, e-invoice seller details. | — |
| Q4a | Install on this machine: **GitHub CLI** (`gh auth login` with access to `ERP-SPACE`) and **Docker Desktop**. Alternatively, create the empty private repo `ERP-SPACE/erp-platform` yourself. | Repo creation and local Postgres/Redis. | ADR-0019 |

## Before Stage 1 (masters)

| # | Question | Why it matters | Linked |
|---|---|---|---|
| Q6 | Rounding of derived per-metre rates (2 decimals, or 10/50 paise)? Override tolerance (PRD says 5%)? Who approves over-tolerance overrides: Sales Manager, or only Owner? | Pricing + approval flow. | PRD §8.1 |
| Q7 | Default credit policy for new customers (limit, credit days, grace days, block rule)? | Onboarding defaults. | PRD §6.7 |
| Q8 | Confirm the master lists: GSMs (30, 35, 45, 55, 65, 80, 100), qualities + trade aliases, widths (24/36/44/63 + others?), lengths, categories beyond Sublimation & Butter. | Seed data and validation. | — |
| Q9 | HSN code and GST rate per category. **CA** | Printed on every invoice line and in the e-invoice JSON. | PRD §8.6 |
| Q10 | Do salesmen/brokers log in themselves, or does office staff enter everything for them? | Roles, scoping. | PRD §4 |
| Q11 | Is commission % calculated on the taxable value (before GST, after discounts)? | Commission engine. | PRD §5.6 |

## Before Stage 2 (purchase & inventory)

| # | Question | Why it matters | Linked |
|---|---|---|---|
| Q12 | Hardware: thermal label printer (TSC/Zebra 4″) + USB scanner? Label size (default 100×50 mm)? Android phones in the godown? | Label templates (ZPL vs PDF), PWA testing. | ADR-0006/7 |
| Q13 | At inward, do you measure each roll's actual length, or accept the supplier's nominal length? | GRN capture per roll vs per line. | Port matrix 3.3 |
| Q14 | Does the supplier invoice ever arrive before the goods (PI before GRN)? | PI/GRN ordering rules. | ADR-0017 |
| Q15 | Track godown location (zone/rack/bin) per roll? | Pick lists, `/floor` UI. | Port matrix 3.4 |
| Q16 | Typical landed-cost components and how you split them today (per roll, per metre, by value)? | Default basis per component. | PRD §8.3 |

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
