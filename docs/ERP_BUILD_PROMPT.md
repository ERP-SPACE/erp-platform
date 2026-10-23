# Paper Trading ERP — Master Build Prompt (v1)

> **How to use this file**
> 1. Start a Claude Code session in `C:\Users\utsav\Documents\OFF SOCIAL\ERP\APPLICATION`.
> 2. Paste **Part A (Master Prompt)** once. The agent turns it into `erp/CLAUDE.md` and `erp/docs/` and then stops.
> 3. Run the stages in **Part C** one at a time. Paste the stage's kick-off prompt, review the plan the agent proposes, and approve it. Do not start the next stage until the current stage's acceptance gate passes.
> 4. The PRD is `ERP_PRD_v2.docx`. Copy it into `erp/docs/prd/` before step 2 so the agent can read it.

---

# PART A — MASTER PROMPT (paste once)

You are a principal engineer who has shipped trading and distribution ERPs for Indian SMEs. You know GST, roll-based paper and textile inventory, and Tally-trained users well. You will build a production-grade ERP for a **sublimation & speciality paper trading company in Surat, Gujarat**. It must be correct, fast, keyboard-friendly, and elegant to look at.

## A1. Source of truth and ground rules

- **Requirements:** `erp/docs/prd/ERP_PRD_v2.docx` (PRD v2). Read all of it before you plan anything. Where this prompt and the PRD disagree, this prompt wins. Where this prompt flags a PRD issue (§A9), implement the flagged resolution and record it in `docs/decisions/`.
- **Legacy reference (read-only):** `erp_api/` (Express + Mongoose) and `erp_web_app/` (CRA + MUI) are an earlier build for the same company, based on an older PRD. They hold **test data only**, so nothing is migrated. They do contain business logic that is ahead of the PRD in places. Port that logic to the new stack with tests. **Never modify the legacy folders.**
- **New code** lives in a new monorepo: `erp/` (sibling to the legacy folders). Initialise git there with `main` plus a branch per stage.
- **Deferred to a later stage. Do NOT build these now, but design for them (§A7):**
  - **Accounting:** chart of accounts, vouchers, ledgers, GST summary, Tally replacement.
  - **WhatsApp:** ordering, dunning, broadcasts.
- **Work style:**
  - Plan before code: for each stage, present a plan (schema, endpoints, screens, tests) and wait for approval.
  - Small, reviewable commits.
  - Never mark a stage done unless its tests pass. Show the test output.
  - Ask me when a business rule is ambiguous. Don't guess.
  - Keep `docs/decisions/NNNN-title.md` (ADRs) for every non-obvious choice.

## A2. Users and scale

- Fewer than 15 concurrent users: owner, admin, purchase manager, sales staff, warehouse staff, accountant.
- Single hub (Surat). Multi-branch and pan-India must be possible later **without schema changes** (carry `company_id` / `branch_id` columns from day one, defaulting to one row).
- Optimise for correctness, auditability, and response time. Do not optimise for horizontal scale. Avoid microservices. Build a **modular monolith**.

## A3. Technology stack (decided — do not substitute without an ADR)

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript (strict)** everywhere, Node.js 22 LTS | One language, shared types end-to-end |
| Monorepo | **pnpm workspaces + Turborepo** | `apps/api`, `apps/web`, `apps/worker`, `packages/*` |
| Database | **PostgreSQL 17** (AWS RDS, Multi-AZ optional) | ACID transactions for postings, row locks, CHECK/EXCLUDE constraints, CTEs, materialized views, 30-day PITR. Replaces MongoDB. |
| ORM / SQL | **Drizzle ORM** + drizzle-kit migrations; raw SQL allowed for reports | Close to SQL; works well for locks, CTEs, views |
| API | **NestJS 11 on the Fastify adapter**, Zod DTOs (`nestjs-zod`), OpenAPI generated | Modules map to ERP domains; guards cover RBAC; interceptors cover audit and idempotency |
| Shared contracts | `packages/contracts` — Zod schemas + generated typed client (`openapi-typescript` + `openapi-fetch`) | The frontend and backend cannot drift apart |
| Domain core | `packages/domain` — pure TS functions: pricing, rounding, GST, landed cost, allocation, credit, commission, state machines | 100% unit-testable with no DB |
| Jobs / realtime | **Redis (ElastiCache) + BullMQ**; Redis pub/sub → **Server-Sent Events** | Scheduled refreshes, PDF/label rendering, imports, notifications |
| Frontend | **React 19 + Vite**, **TanStack Router** (type-safe routes, search-param state), **TanStack Query**, **TanStack Table + Virtual**, **React Hook Form + Zod** | Fast SPA for an internal tool. No SSR needed. |
| UI primitives | **Radix UI** primitives + **Tailwind CSS v4** with a custom token system (§B). **cmdk** for the command palette. | Accessible primitives with a fully custom look. No stock MUI/shadcn appearance. |
| Charts | **visx** (custom, editorial-styled charts) | Charts that match the design instead of default-dashboard looks |
| Money/maths | **decimal.js** in the domain layer; Postgres `numeric` in storage. **Never use JS floats for money.** | Paise-exact GST and rounding |
| Auth | **Better Auth**: session cookies (httpOnly, SameSite=strict), argon2id, TOTP for Owner, step-up re-auth for sensitive actions | Meets PRD §12 security |
| Documents | HTML templates rendered to PDF by **Playwright (Chromium)** in the worker; labels as PDF **and** ZPL | GST invoices, DC, PO, proforma, roll labels |
| Scanning | Keyboard-wedge listener (USB/BT scanners) **and** camera scanning in the PWA (`BarcodeDetector` with `zxing-wasm` fallback) | Hardware isn't chosen yet, so support both |
| Testing | **Vitest** (unit, `fast-check` property tests for money/allocation), **Testcontainers Postgres** (integration), **Playwright** (E2E encoding PRD §11 UAT scripts) | |
| Observability | pino JSON logs, OpenTelemetry traces, Sentry (web + api), `/healthz` + `/readyz` | |
| Infra | AWS **ap-south-1**: ECS Fargate (api, worker, web via CloudFront+S3), RDS Postgres, ElastiCache Redis, S3 (documents, KYC, exports), Secrets Manager. GitHub Actions → ECR → ECS (reuse the pattern in `erp_api/.github/workflows/deploy.yml`). IaC with **Terraform**. Separate `stage` and `prod`. | Matches the existing AWS footprint. Data stays in India. |

## A4. Architecture rules (non-negotiable)

1. **Modules:** `identity`, `settings`, `catalogue`, `parties` (suppliers, transporters, customers, contacts), `salesmen`, `pricing`, `purchase`, `inventory`, `sales`, `collections`, `credit`, `commission`, `reports`, `migration`, `audit`, `documents`, `notifications`. Later: `accounting`, `whatsapp`. Modules call each other only through their public service interfaces. No cross-module table writes.
2. **One transaction per business command.** Posting a GRN, PI, DC, SI, return, or receipt is one DB transaction: state change, roll updates, document number, audit row, and posting event. All succeed or all fail.
3. **Money:**
   - `numeric(14,2)` for amounts, `numeric(12,4)` for rates, `numeric(10,2)` for metres, `numeric(5,2)` for inches.
   - All arithmetic goes through `packages/domain/money.ts` (decimal.js).
   - Use largest-remainder rounding wherever amounts are split (bill discount, landed cost, GST).
4. **State machines** are explicit transition tables in `packages/domain/state/*.ts`, enforced in services, and backed by Postgres `CHECK` on the status enum. Every transition writes to `status_transitions` (entity, from, to, by, at, reason). Illegal transitions throw a typed error.
5. **Document numbers:**
   - Gapless, per type, per financial year (Apr–Mar). Format tokens include `{FY}` → `2627`.
   - Allocate the number with `SELECT … FOR UPDATE` on `document_sequences`, inside the posting transaction. Don't use Postgres SEQUENCEs, because those leave gaps.
   - Sales invoices get their number **on posting**. Drafts show `DRAFT-<short-id>`. GST needs consecutive SI numbers of 16 characters or fewer; validate this when a series is configured.
6. **Roll concurrency:** pick and allocate rolls with `SELECT … FOR UPDATE SKIP LOCKED`, so two users can never dispatch the same roll.
7. **Idempotency:** every create/post endpoint accepts an `Idempotency-Key` header. Double-clicks and retries must not create duplicates.
8. **Optimistic concurrency:** every editable aggregate has a `version` column. A stale update returns 409, and the UI shows a "changed by X — reload" notice.
9. **Audit log (PRD §4.2, §12):**
   - Write a row on every insert/update/delete with user, timestamp, before-JSON, after-JSON, request id, and reason.
   - Implement it as a Postgres trigger on audited tables, plus an app-level `reason` passed via `SET LOCAL app.reason`.
   - The table is append-only: `REVOKE UPDATE, DELETE` from the app role. Partition it by month. Retain for 7 years, with old partitions archived to S3.
10. **Posting events (outbox) — this is how accounting gets built later without rework:**
    - From the first posted document, every financially relevant command writes a row to `posting_events`. Types: `PI_POSTED`, `SI_POSTED`, `DC_POSTED`, `RECEIPT_POSTED`, `PAYMENT_POSTED`, `SALES_RETURN_POSTED`, `PURCHASE_RETURN_POSTED`, `ROLL_SCRAPPED`, `LANDED_COST_ALLOCATED`, `LANDED_COST_VARIANCE`, `BILL_DISCOUNT_APPLIED`.
    - Each row carries a complete, immutable payload: party, amounts per tax head, taxable value, COGS per roll, landed cost components, and HSN.
    - When the accounting stage starts, its voucher generator consumes and **back-fills** these events. That gives 100% auto-voucher coverage of history.
11. **Configuration over code:** these all live in Settings tables, with audit, not constants:
    - allowed widths and lengths
    - GSM list, qualities and aliases
    - HSN per category
    - rounding precision
    - override tolerance %
    - credit rules
    - document series
    - label size
    - dead-stock days (180) and aging buckets
12. **Security:**
    - RBAC with permissions such as `sales.so.confirm` and `credit.override`. Roles are permission bundles.
    - Data scoping: a sales exec sees only assigned customers, and access can be limited by customer group or product family. Enforce scoping in the query layer, not only in the UI.
    - Step-up re-auth (password/TOTP within the last 5 minutes) for: credit override, rate override above tolerance, posting reversals, go-live lock, user/role changes.
    - Rate limiting, Helmet-equivalent headers, CSRF protection for cookie auth, and S3 presigned uploads for KYC.

## A5. Data freshness (the "3–5 minutes" requirement)

Use **3 minutes** as the standard refresh, plus push updates where freshness matters more:

| Data | Mechanism | Freshness |
|---|---|---|
| Credit check, exposure, roll availability, document status | Computed transactionally in the request path | **Live** (< 1 s, PRD §12) |
| Lists and boards others are editing (Sales Board, Unmapped staging, DC pending) | Domain events → Redis pub/sub → **SSE** → TanStack Query invalidation | **Seconds** |
| Analytics: stock by GSM/Quality/Width, batch aging heatmap, AR aging, margin, salesman performance, churn risk | Postgres **materialized views**, `REFRESH MATERIALIZED VIEW CONCURRENTLY` from a BullMQ repeatable job **every 3 min** during business hours (08:00–20:00 IST) and every 30 min otherwise | **≤ 3 min** (PRD KPI ≤ 5 min) |
| Dead-stock flag (> 180 days), unmapped-age alerts, overdue/grace evaluation | Nightly job at 02:00 IST + on-demand | Daily, plus live check at SO confirm |

Every analytic surface shows an unobtrusive **"as of 14:32 · refreshes every 3 min"** stamp and a manual refresh action.

## A6. Legacy logic to port

Before Stage 1, read the legacy code and produce `docs/legacy-port-matrix.md`: one row per capability, with **Keep logic / Improve / Replace with PRD** and the legacy file reference. Port kept logic into `packages/domain` with unit tests written **from the legacy behaviour first** (characterisation tests), then adapt to PRD v2.

Known candidates (verify each one):

- `erp_api/services/allocationService.js`
  - Roll auto-suggest for a required metreage.
  - FIFO standard-length rolls first, then longest remnants.
  - Shortfall tolerance, then a swap optimisation on the last allocated rolls.
  - This is **more advanced than the PRD** ("auto-suggest Mapped rolls"). Keep it, and make the tolerance and standard length configurable.
- `erp_api/services/agentService.js` + `models/Agent.js`
  - Salesman default rates per product, commission normalisation, rate history, customer ↔ agent mapping sync.
  - Reconcile with PRD §5.6 (`trigger_event`, `is_default`, payouts).
- `erp_api/services/pricingService.js` (`calculateWidthRate`) and `controllers/salesOrderController.js`
  - Benchmark SKU resolution and `getBenchmarkRate44ForCustomer`.
  - Credit check on confirm; `buildProcessedLine` (line pricing plus allocation).
- `erp_api/services/rollService.js`
  - Bulk mapping inside a transaction, with GSM/quality lookup by name.
- `erp_api/controllers/purchaseInvoiceController.js`
  - Roll-detail normalisation, PO-line resolution by key, direct PI lines, landed cost split.
  - **Note:** the legacy code creates rolls at PI. PRD v2 says rolls and barcodes are created at **GRN posting**. Follow the PRD.
- `erp_api/services/numberingService.js`: supplier/customer/batch/roll code formats. Keep the formats if they are good.
- Customer contact persons with a single primary; customer groups as a **master table**, which is more flexible than the PRD enum. Keep it as a table seeded with Cash, Wholesale, Big, and allow many-to-many and none.
- `erp_web_app/src/utils/salesLinePricing.js`: the client-side line pricing preview. Move it to `packages/domain` so client and server share one implementation.

## A7. Scope for this build

**Build now (Stages 0–6):**

- Everything in PRD v2 §5–§12, **except**:
  - the Ledger/Voucher/Chart-of-Accounts entities
  - accounting views and GST summary export
  - WhatsApp
- **Keep these** because credit control depends on them:
  - Customer/supplier **sub-ledger** (outstanding per invoice)
  - **Receipts & Payments**
  - **Invoice allocation**
  - AR/AP **aging**
  - Credit/debit note documents (as documents; their vouchers come later)

**Design-for-later (later stage A — Accounting):**

- CoA, voucher engine consuming `posting_events` with back-fill, ledger browser, GST summary CSV, Tally-style voucher entry.
- Add a later-stage note in `docs/roadmap.md` covering:
  - double-entry enforced by a deferred constraint trigger (Σ Dr = Σ Cr per voucher)
  - posted vouchers immutable

**Design-for-later (later stage B — WhatsApp):**

- Capture `whatsapp_number`, `whatsapp_language` (EN/HI/GU), and `whatsapp_consent` with timestamp and source now.
- Add a `notifications` outbox with a `channel` column, so WhatsApp becomes another channel adapter later.
- Show the Customer 360 WhatsApp tab as a quiet placeholder.

## A8. Domain rules (from the PRD — implement exactly, test exhaustively)

- **Pricing:**
  - `derived_rate(W) = base_rate_44 × W / 44`, rounded per setting (default nearest ₹1).
  - Customer party rate has validity ranges. Use a Postgres `EXCLUDE USING gist` constraint to prevent overlapping ranges for the same customer + product.
  - Order deal rate overrides the party rate for that SO.
  - An override beyond tolerance moves the SO to `PendingApproval` (an internal sub-state of Draft) and requires manager approval with a reason before confirm.
  - Every effective rate is written to Rate History.
  - Bulk rate revision is by customer group or product family, with preview and audit.
- **Discounts:** a line discount comes before tax. A bill discount is allocated pro-rata to lines by taxable value using largest remainder, so per-line GST is exact and Σ lines = invoice total to the paisa.
- **GST:**
  - Company state vs place of supply gives CGST+SGST or IGST.
  - Derive the state code from GSTIN chars 1–2 and validate the GSTIN checksum.
  - HSN on every line.
  - SEZ is zero-rated, with LUT ref on the invoice.
  - Manual override is allowed with an audit reason.
  - See §A9 for Bill of Supply.
- **Landed cost:**
  - `alloc_i = component × basis_i / Σ basis` (ROLL / METER / VALUE), using largest remainder so the split sums exactly.
  - Show a per-roll preview before posting.
  - Reallocation after some rolls are dispatched: only undispatched rolls are revalued, and the difference for dispatched rolls goes to a `LANDED_COST_VARIANCE` posting event.
- **COGS:** Σ landed cost of billed rolls (or of the partial length billed). Inventory credit = COGS exactly.
- **Partial return:** `partial_COGS = returned_m / dispatched_m × landed_cost_per_roll`. The roll goes to Returned, then inspection, then either Scrap (write-off event) or Mapped with the new length.
- **Credit:**
  - `exposure = outstanding AR + value of Confirmed/PartiallyFulfilled SOs` (OnHold SOs don't count and don't reserve stock).
  - Rules: OVER_LIMIT, OVER_DUE (any invoice past `credit_days + grace_days`), BOTH.
  - Run on Confirm, in under 1 s. On block → OnHold + internal notification.
  - Owner override needs step-up auth plus a reason.
  - Grace days are never shown on any customer-facing document.
- **Commission:**
  - `PER_METER` or `PERCENT_SALES`.
  - Trigger is `ON_SI_POSTED` or `ON_PAYMENT_RECEIVED` (pro-rata to the allocated amount).
  - Automatic reversal on credit note, with `reversal_reason`.
  - Payout marking in batches.
  - Salesman `block_mode` (None/All/Selective) blocks new DC/SI for assigned customers.
- **Flows:**
  - Standard: SO → DC → SI, at most 2 clicks per stage.
  - Direct invoice (cash): SO → SI.
  - Proforma has its own series, no financial effect, and converts to an SI.
  - Partial DC leaves the SO PartiallyFulfilled with backorders tracked.
  - A DC auto-closes when fully invoiced.
  - A PO auto-closes when everything is received and invoiced; admin can force-close.
- **Purchase edge cases:**
  - GRN over-receipt needs admin override with a reason.
  - A PI without a PO line warns and requires a reason.
  - Multiple PIs per PO are allowed.
  - Feed all of these into the PO vs GRN vs PI variance report.
- **Barcode:** `YYMM-SUP-BATCH-SEQ-CHECK` (Luhn mod-36 check character), plus a QR code. Reprint at any time; reprints are logged.

## A9. PRD issues to resolve (implement the resolution, record an ADR, and show me the list in Stage 0)

1. **QR payload exposes landed cost.** PRD §5.3 puts `landed_cost` inside the QR. Anyone with a phone, including customers and transporters, could read your cost price. **Resolution:** the QR encodes only the barcode string (or a signed short URL). The full lineage is fetched server-side according to the scanner's role.
2. **Barcode format conflict.** §5.3 says `SEQ`; §6.1 says `ROLLID`. **Resolution:** use `SEQ` (a short, human-readable per-batch sequence). The roll UUID stays internal.
3. **"GST" as a landed-cost type.** Input GST is normally claimable ITC and should **not** be capitalised into inventory cost. **Resolution:** remove GST from landed-cost types (keep the enum value hidden for non-ITC cases behind an admin flag). Confirm with the CA.
4. **Bill of Supply for Unregistered customers.** Under GST, a **regular** registered seller must still charge GST to unregistered (B2C) buyers. A Bill of Supply is for exempt supplies or composition-scheme *sellers*. **Resolution:** issue a tax invoice to Unregistered and Composition buyers (as B2C or B2B respectively), and keep Bill of Supply as a template you can turn on per series. **Must be confirmed with the company's CA before Stage 3.**
5. **TCS flag.** TCS on sale of goods (s.206C(1H)) was withdrawn from 1 April 2025. Keep the `tcs_applicable` flag (the PRD asks for it) but label it "reserved". Confirm with the CA.
6. **E-way bill / e-invoice.**
   - Add `eway_bill_no` and `eway_bill_date` (manual entry) to the DC now, alongside transporter, vehicle, and LR.
   - Ask me for annual turnover. If it is above ₹5 Cr, e-invoicing (IRN) is already mandatory and cannot wait for Phase 2.
7. **SO quantity unit.** The PRD SO line is `qty_rolls × length_m_per_roll`. The legacy system allocates by required **metres**. **Resolution:** an SO line stores both rolls and metres. Pricing is per roll as derived; allocation works in metres using the ported algorithm.

## A10. Definition of done (every stage)

- Migrations are reversible. Seed scripts provide realistic Surat data:
  - GSMs 30–100; Premium/Standard/Economy; widths 24/36/44/63
  - 8 suppliers, 40 customers across groups, 5 salesmen, 3 transporters
- Unit + integration tests are green. The E2E tests for the stage's PRD §11 UAT scripts are green. Domain packages have ≥ 90% coverage.
- p95 latency: list endpoints < 300 ms, credit check < 1 s, scan lookup < 500 ms. Measure these with seeded data (≥ 50k rolls) and report the numbers.
- Accessibility: keyboard reachable, visible focus, WCAG AA contrast in both themes.
- `docs/` is updated: module README, API changes, ADRs, and a user-facing "how it works" page for the module.

**Stop after creating `erp/CLAUDE.md` (a condensed version of Part A + Part B), `docs/legacy-port-matrix.md`, and `docs/decisions/0001…` for §A9. Then give me the list of questions you still have.**

---

# PART B — DESIGN SYSTEM: "Editorial Ledger"

The ERP must **not** look like a dashboard template: no grid of coloured KPI tiles, no gradient cards, no sidebar of rainbow icons. It should feel like a **finely printed ledger book that happens to be interactive**: calm, typographic, exact. The users trade paper, so the interface should feel like good paper.

## B1. Principles

1. **Documents, not widgets.** Every PO, GRN, SO, DC, SI, and return opens as a *sheet*: a centered, paper-proportioned page with letterhead-like header, ruled line items, and totals set like a printed invoice. Status, timeline, audit, and actions sit in a **margin column** to the right ("margin notes"). What you see on screen matches the PDF.
2. **Typography carries hierarchy.** Use size, weight, and spacing before colour, boxes, or shadows. Use hairline rules (1px) instead of cards.
3. **Numbers are first-class.**
   - Tabular, lining figures everywhere.
   - Indian digit grouping (₹ 4,82,300.00, with lakh/crore abbreviations in briefs).
   - Right-aligned numbers with decimals aligned. Negative amounts in parentheses, in the ink-red tone.
   - Metres and inches are always unit-suffixed (`1,000 m`, `44″`).
4. **Keyboard first** (users come from Tally):
   - `⌘/Ctrl K` command palette for everything (go to, create, find a party/roll/document by number).
   - Single-key shortcuts inside sheets (`A` add line, `P` post, `Esc` back), with a `?` overlay listing them.
   - Enter moves to the next field in line-item grids. `Alt+N` creates a new document in context.
5. **Quiet by default, loud only when it matters.** Colour is reserved for state that needs action: on-hold, overdue, unmapped > 24 h, over-tolerance.
6. **Density control:** Comfortable / Compact toggle per user. Compact is for the accountant and warehouse grids.

## B2. Tokens (define as CSS variables, with Tailwind v4 `@theme`; light is primary, dark is "Night Ledger")

| Token | Light | Dark |
|---|---|---|
| `--paper` (canvas) | `#FBF8F2` ivory | `#14171C` |
| `--sheet` (document surface) | `#FFFFFF` with 1px `--rule` border, very soft shadow `0 1px 2px rgb(27 36 51 / .04)` | `#1A1E24` |
| `--ink` (primary text) | `#1B2433` ink-navy | `#E8E4DA` |
| `--ink-2` (secondary) | `#5B6472` | `#A3A9B3` |
| `--rule` (hairlines) | `#E6DFD2` | `#2A2F37` |
| `--accent` (single brand accent) | `#7A2E2E` oxblood (links, focus, primary button) | `#D08A7A` |
| `--positive` | `#2F6B4F` | `#7FC4A0` |
| `--caution` | `#9A6B12` ochre | `#E0B35A` |
| `--critical` | `#A23B2A` | `#E5806E` |
| `--info` | `#2B5C8A` | `#86B3DD` |

- **Type:**
  - **Newsreader** (or Fraunces) for page titles and document headings
  - **Inter** with `font-feature-settings: "tnum","lnum","cv11"` for UI and tables
  - **JetBrains Mono** for barcodes, document numbers, and GSTINs
  - Self-host the fonts (no Google Fonts at runtime).
- **Scale:** 12 / 13 / 14 (base UI) / 16 / 20 / 28 / 40 (titles). Line height 1.45 for UI, 1.25 for headings.
- **Spacing:** 4-pt grid. Radius 2–4px; sheets have square corners.
- **Motion:** 120–180 ms ease-out. Sheets slide in from the right in split view. Respect `prefers-reduced-motion`.
- **Status marks:** a small filled dot plus a word ("● On hold"). Never use pill badges in saturated colours.

## B3. App shell

- **Top bar:** wordmark (company name in Newsreader small caps), global search / ⌘K, live-sync indicator (a tiny dot that breathes when SSE is connected), user menu.
- **Left rail:** text-only sections in small caps: *Today, Sales, Purchase, Stock, Parties, Collections, Reports, Settings*. No icon zoo. Collapsible to initials.
- **Split view everywhere:** list on the left as a ruled register, the selected document as a sheet on the right. Deep-linkable URLs; list filters live in search params.

## B4. Signature screens (map to PRD §10)

1. **Today (replaces the "Owner Dashboard")** — a morning **brief** written like the front page of a ledger, not a tile grid:
   - Dateline: "Thursday, 23 October · as of 14:32".
   - A lead paragraph generated from data: "₹ 4.8 L invoiced today across 12 invoices; collections ₹ 2.1 L; 3 orders on hold (₹ 2.4 L exposure)."
   - **"Needs you"**: a ruled worklist of actionable items (approvals, credit blocks, unmapped rolls > 24 h, DCs pending invoice). Each row is one keystroke from resolution.
   - Then quiet small-multiple charts (visx, thin strokes, no fills unless meaningful): 30-day sales line, AR aging as a horizontal **waterfall**, and a **stock aging heatmap** (GSM × width, cell shade = age).
   - The same layout is role-filtered: warehouse sees rolls to map/pick; accountant sees receipts to allocate.
2. **Catalogue** — a typographic **tree** (Category → GSM → Quality → Width) styled like a book index, with inline add/edit and a bulk-add widths action. HSN/tax editor in the margin.
3. **Purchase sheets (PO → GRN → PI)** — a stepper shown as a thin "chapter" line at the top of the sheet. The landed-cost allocator shows a per-roll preview table with the basis selector and live totals before posting.
4. **Unmapped staging** — a dense register of unmapped rolls with an age column in ochre/red after 24 h. Multi-select plus `M` to bulk map, with inline SKU creation.
5. **Roll Inspector** — scan or type a barcode. Shows a vertical **lineage thread** (supplier → batch → GRN → PI → landed-cost components → SO → DC → SI → returns), each node a dated line. Actions: reprint label, mark scrap (reason), adjust length.
6. **Sales Board** — five columns (Draft, On hold, Confirmed, Partial, Closed) styled as ledger columns with hairline separators. Cards are typeset entries showing party, amount, and age. The right pane holds the **44″ pricing calculator** (enter width and see the derived rate, party rate, deal rate, and tolerance band).
7. **Invoicing** — pick DC → SI sheet preview, showing HSN, the GST split, discount allocation, and round-off → **Post** (step-up only if required).
8. **Customer 360 ("Dossier")** — header with party name, GSTIN (mono), and groups. Tabs: Profile & contacts · Credit (exposure vs limit, drawn as a single elegant bar with the grace window) · Rates (history timeline and deals) · Orders · Invoices · Outstanding & receipts · Commission · WhatsApp (placeholder).
9. **Salesman manager** — register, per-customer commission rules, accrual and payout history, block settings.
10. **Opening Balance Wizard** — chapters: Stock → AR → AP → Review → Go-Live lock. Each import shows a validation report before commit (unknown parties, totals vs legacy books).
11. **Settings** — document series (with a live preview of the next number), allowed widths, company GST profile, users & roles (a permission matrix), and an audit log viewer with a JSON before/after diff.
12. **Warehouse PWA (`/floor`)** — large type, high contrast, works offline for scans. Covers Receive (GRN scan), Map, Pick for DC, Inspect/Scrap, and Print label. Camera scanning plus scanner-gun support.

## B5. Print and PDF

Invoice, DC, PO, proforma, credit/debit note, and statement templates share the sheet design:

- A4, company letterhead, GSTIN, HSN summary table, amount in words (Indian system), bank details, signatory block, and a QR code with the document reference.
- Roll labels at 100×50 mm (configurable): barcode string in mono, QR code, GSM/quality/width/length, batch, and supplier code. **No cost on the label.**

---

# PART C — STAGED DELIVERY (paste one kick-off at a time)

Each stage ends with: green tests, a demo script I can click through on stage, an updated changelog, and a merge to `main`. Deploy to the **stage** environment from Stage 1 onward.

### Stage 0 — Foundation (≈1 week)
> Read Part A/B and the PRD. Produce the legacy-port matrix and ADRs for §A9, then scaffold:
> - the monorepo (pnpm/Turborepo, strict TS, ESLint flat config + Prettier, Vitest, Playwright)
> - `apps/api` (NestJS + Fastify), `apps/worker` (BullMQ), `apps/web` (Vite + TanStack Router), `packages/{domain,contracts,ui,db,config}`
> - Docker Compose for local Postgres 17 + Redis
> - Terraform for stage
> - GitHub Actions: lint → typecheck → test → build → deploy-stage
>
> Implement:
> - identity (Better Auth, roles, permissions, scoping, step-up auth)
> - audit (triggers + viewer API)
> - settings (company profile, allowed widths/lengths, tolerance, rounding, aging buckets)
> - document series with FY reset and gapless allocation
> - idempotency + optimistic concurrency middleware
> - the SSE channel
> - `posting_events` outbox table
>
> Build the design system in `packages/ui`: tokens, typography, Sheet, Register (virtualised ruled table), MarginNotes, Money/Qty formatters (Indian grouping), StatusMark, CommandPalette, Stepper, Form primitives. Also build the app shell, the login screen (styled in the Editorial Ledger look), and a Storybook-style `/_design` route showing every component in light and dark.
>
> **Gate:** a user can log in, change a setting (audit row visible with a diff), and configure a series whose preview shows `SI-2627-00001`. The design route passes axe checks.

### Stage 1 — Masters (≈1–1.5 weeks)
> Build:
> - Catalogue tree (categories, GSM, quality + aliases, products, SKUs with the unique `(product, width)` constraint)
> - Suppliers
> - Transporters
> - Customers: GSTIN validation, GST type, groups m:n, contacts with a single primary, referral source, monthly capacity, target metres, TCS flag (reserved), WhatsApp fields + consent
> - Credit policy 1:1
> - Party rates (no overlapping validity)
> - Salesmen: KYC uploads to S3, defaults applied to newly onboarded customers, `block_mode`
> - Party-wise commission rules
> - Bulk rate revision with preview
> - Customer 360 shell, Salesman manager, Catalogue screen
> - Seed data
>
> **Gate:** create a customer via the keyboard only in under 60 s; a salesman's defaults pre-fill a new customer; overlapping rate ranges are rejected by the DB.

### Stage 2 — Purchase & Inventory (≈2 weeks)
> Build:
> - PO (draft/approve/close/cancel; SKU or raw-attribute lines)
> - GRN (partial receipts, accepted/rejected/unmapped quantities, over-receipt override)
> - Roll creation + barcode generation on GRN posting
> - Batch
> - Unmapped staging with bulk map / inline SKU create
> - PI (GST type from supplier state, lines with or without PO link plus reason, multiple PIs per PO)
> - Landed cost components + allocator (ROLL/METER/VALUE, preview, largest remainder) + post-dispatch variance event
> - Purchase return + debit note document
> - Roll state machine; Roll Inspector; label PDF + ZPL; reprint log; scrap
> - Warehouse PWA (`/floor`): receive, map, inspect
> - Materialized views: stock by SKU/batch/vendor, batch aging, unmapped age, dead stock (> 180 days)
> - Write `posting_events` for PI, purchase return, scrap, and landed cost
>
> **Gate:** PRD UAT §11.1 and §11.2 (except the sales-return item) pass as Playwright tests. Landed cost per roll sums to the PI component total to the paisa.

### Stage 3 — Sales (≈2–2.5 weeks)
> **Before starting, confirm with me the CA's answer on §A9 #4 (Bill of Supply) and #6 (turnover / e-invoice).**
>
> Build:
> - Pricing engine (44″ derivation, party/deal/override precedence, tolerance → approval with step-up)
> - Rate History
> - SO: credit check on confirm in under 1 s, OnHold, approval flow, backorders
> - Sales Board with SSE live updates
> - DC: ported allocation suggestion, scan-to-pick with `SKIP LOCKED`, transporter/vehicle/LR/e-way fields, partial DC
> - SI: one click from DC, sheet preview, line + bill discount allocation, GST split, round-off, posting assigns the number, immutability
> - Direct cash invoice
> - Proforma (own series, convert to SI)
> - Sales return with partial-COGS credit note document; inspection → scrap/re-map
> - Salesman `block_mode` enforcement
> - `posting_events` for SI, DC, and sales return
> - PDFs: SO, proforma, DC, SI, credit note
> - Warehouse PWA: pick for DC
>
> **Gate:** PRD UAT §11.3 and §11.4 pass. SO → DC → SI takes at most 2 clicks per stage, measured in the E2E test. Two simultaneous pickers can never take the same roll (concurrency test).

### Stage 4 — Collections, Credit & Commission (≈1.5 weeks)
> Build:
> - Receipts (customer) and payments (supplier): modes, references, multi-invoice allocation, on-account/unallocated flagged
> - Customer/supplier outstanding sub-ledger and statements (PDF)
> - AR/AP aging (0–30 / 31–60 / 61–90 / 90+)
> - Credit exposure live + nightly overdue/grace evaluation; auto-block/unblock; blocked-orders view; Owner override with step-up
> - Commission accrual on `ON_SI_POSTED` / `ON_PAYMENT_RECEIVED` (pro-rata), automatic reversal on credit note, payout batches
> - `posting_events` for receipts, payments, and discounts
>
> **Gate:** PRD UAT §11.5 (the receipt-allocation item) and §11.6 pass. Exposure includes Confirmed/PartiallyFulfilled SO value and excludes OnHold.

### Stage 5 — Reports, Analytics & "Today" (≈1.5 weeks)
> Build all PRD §9 reports except accounting statements:
> - operational, sales, purchase, credit/AR, profitability
> - gross margin by SKU/customer/month, price vs COGS, scrap impact, commission payout
>
> Use materialized views on a 3-minute refresh with "as of" stamps. Build the role-aware **Today** brief (§B4.1) and the visx charts (sales trend, AR waterfall, stock aging heatmap). Add a pivot builder (dimensions: SKU, customer, group, vendor, salesman, date; measures: metres, rolls, value, margin) with save/share and CSV/XLSX/PDF export (export runs in the worker and lands in S3 with a download link).
>
> **Gate:** Today loads in under 1.5 s p95 on the 50k-roll dataset. Every report reconciles with the underlying documents (reconciliation tests).

### Stage 6 — Opening Balances, Hardening & Go-Live (≈1–1.5 weeks)
> Build the Opening Balance Wizard:
> - stock roll-by-roll CSV or per-SKU aggregate, with Σ landed cost = legacy inventory value
> - opening AR/AP CSV as opening invoices in the sub-ledger, flagging unknown parties
> - review, then the Go-Live lock (locks on the first live posting; later corrections need an adjustment with a reason)
> - opening bank/cash balances captured as data for the accounting stage
>
> Then hardening:
> - security review (authz tests per permission, IDOR tests, rate limits)
> - load test (k6) at 3× expected load
> - RDS PITR 30 days verified with a restore drill
> - audit partition archival job
> - prod Terraform, runbook (`docs/runbook.md`: deploy, rollback, restore, rotate secrets)
> - user guide per role (short, illustrated)
> - full PRD §11 regression
>
> **Gate:** a restore drill succeeds; all UAT passes on stage; I sign off; deploy to prod.

### Later Stage A — Accounting (separate kick-off)
> Build the Chart of Accounts per PRD §6.8 (system ledgers non-deletable), and a voucher engine that **consumes and back-fills `posting_events`** using the PRD auto-voucher matrix. Enforce double-entry with a deferred constraint trigger; posted vouchers are immutable. Also build: manual journal (Draft → review → Post), Tally-style keyboard voucher entry, ledger browser with running balance, GST summary + CSV export, and reconciliation of sub-ledger aging vs the AR/AP control ledgers. Then the PRD Phase-2 statements.

### Later Stage B — WhatsApp (separate kick-off)
> Add a channel adapter on the `notifications` outbox (WhatsApp Cloud API / BSP), templates in EN/HI/GU, consent enforcement, then ordering/ledger queries/dunning per PRD v1 §6.8.

---

# PART D — Facts the agent will need from you

Have these ready. The agent will ask for them at the stage shown.

- **Company GST profile:** legal name, GSTIN, address, state, bank details, logo (Stage 0)
- **Annual turnover:** decides whether e-invoicing is needed now (Stage 0)
- **CA confirmation:** Bill of Supply rule, GST in landed cost, TCS (before Stage 3)
- **Override tolerance %, rounding rule, default credit days/grace:** (Stage 1)
- **Label size and printer:** decide by Stage 2. Recommendation: a TSC or Zebra 4″ thermal printer + USB scanner at the inward desk, and Android phones with the `/floor` PWA in the godown.
- **Existing document numbering formats:** if you want continuity with current paper books (Stage 0)
