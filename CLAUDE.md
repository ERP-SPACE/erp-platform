# Paper Trading ERP — Engineering Rules

ERP for a sublimation & speciality paper trading company in Surat, Gujarat. It runs at a single hub with fewer than 15 concurrent users and must be built ready for pan-India.

- **Full brief:** `docs/ERP_BUILD_PROMPT.md`
- **Requirements:** `docs/prd/ERP_PRD_v2.docx`, with a text copy at `docs/prd/ERP_PRD_v2.txt`
- **Decisions:** `docs/decisions/` (ADRs). Where these conflict, ADRs override the PRD, and the brief overrides the PRD.
- **Legacy reference (read-only — never modify):** `../erp_api`, `../erp_web_app`. See `docs/legacy-port-matrix.md`.

## Scope

- **Build now (stages 0–6):**
  - PRD v2 §5–§12, **excluding** Chart of Accounts, vouchers, ledgers, GST summary, and WhatsApp.
  - Receipts/payments, invoice allocation, the customer/supplier sub-ledger, AR/AP aging, and credit/debit note *documents* **are in scope**, because credit control needs them.
- **Later stage A (Accounting):** consumes `posting_events` (ADR-0004) and back-fills vouchers.
- **Later stage B (WhatsApp):** a channel adapter on the `notifications` outbox. Capture `whatsapp_number`, `whatsapp_language`, and `whatsapp_consent` (+ timestamp, source) now.

## Stack (ADR-0001)

- **Monorepo:** pnpm + Turborepo, TypeScript strict, Node 22 LTS.
- **Apps:**
  - `apps/api`: NestJS 11 on the Fastify adapter, Zod DTOs, OpenAPI.
  - `apps/worker`: BullMQ jobs — PDFs (Playwright), labels (PDF + ZPL), imports, exports, materialized-view refresh.
  - `apps/web`: React 19 + Vite, TanStack Router/Query/Table/Virtual, React Hook Form + Zod, Radix UI, Tailwind v4, cmdk, visx.
- **Packages:**
  - `packages/domain`: pure TS business logic (pricing, rounding, GST, landed cost, allocation, credit, commission, state machines). No I/O.
  - `packages/contracts`: Zod schemas + generated typed client.
  - `packages/db`: Drizzle schema, migrations, seeds.
  - `packages/ui`: the design system.
- **Infrastructure:** PostgreSQL 17, Redis. Auth via Better Auth (session cookies, argon2id, TOTP for Owner, step-up re-auth).
- **Testing:** Vitest + fast-check, Testcontainers Postgres, Playwright.
- **Repo (ADR-0019):** a single private monorepo, `ERP-SPACE/erp-platform`.
- **Local-first:** Docker Compose runs Postgres 17, Redis 7, MinIO (S3) and Mailpit. S3, email and e-invoice sit behind adapters. Config is env vars validated by Zod.
- **AWS (Stage 7 — Cloud deployment, after local UAT sign-off):** ap-south-1 — ECS Fargate, RDS, ElastiCache, S3, CloudFront; Terraform; GitHub Actions → ECR. No AWS work before Stage 7.

## Non-negotiable rules

1. **One DB transaction per business command:** state change + rolls + document number + audit + `posting_events`.
2. **Money (ADR-0002):**
   - Postgres `numeric` for storage; decimal.js in `packages/domain/money.ts` for maths. **Never** use JS floats for money.
   - Use largest-remainder for every split.
3. **State machines:** explicit transition tables in `packages/domain/state/`, plus a DB CHECK on status. Log every transition to `status_transitions`. Illegal transitions throw.
4. **Document numbers (ADR-0003):** gapless per type per FY via `document_sequences` + `FOR UPDATE`. SI/CN/DN are numbered on posting; GST numbers must be 16 characters or fewer.
5. **Rolls:** pick and allocate with `FOR UPDATE SKIP LOCKED`. Rolls are created at **GRN posting only** (ADR-0017). A roll becomes Allocated when it is picked onto a draft DC (ADR-0014).
6. **Idempotency-Key** on every create/post endpoint. A `version` column (optimistic concurrency) on editable aggregates, with 409 on stale writes.
7. **Audit:** Postgres triggers write before/after JSON. `reason` is passed via `SET LOCAL app.reason`. The table is append-only (REVOKE UPDATE/DELETE), partitioned monthly, and retained for 7 years. Redact secrets.
8. **Posting events (ADR-0004):** every financial command writes an immutable, self-contained payload.
9. **Configuration lives in Settings tables, never constants:**
   - widths, lengths, GSMs, qualities, HSN
   - rounding, override tolerance, credit defaults
   - document series, label size
   - allocation standard length/tolerance, minimum usable length
   - aging buckets, dead-stock days
10. **Security:**
    - Permission-based RBAC (`module.entity.action`). Customer group / product family / own-customers scoping is enforced **in the query layer**.
    - Step-up re-auth for: credit override, rate override above tolerance, reversals, go-live lock, and user/role changes.
11. **Carry `company_id`/`branch_id`** on transactional tables (single default row for now).
12. **Data freshness (ADR-0005):**
    - Live: credit, availability, status.
    - SSE: shared boards.
    - Analytics: materialized views every 3 min during 08:00–20:00 IST, with an "as of" stamp.

## Key domain decisions (see ADRs)

- **QR and label (ADR-0006):** the QR holds the barcode string only. No cost on any label.
- **Barcode (ADR-0007):** `YYMM-SUP-BATCH-SEQ-CHECK` with a Luhn mod-36 check character.
- **Document numbers (ADR-0003):** `{TYPE}/{FY}/{SEQ5}`, e.g. `SI/2627/00001`.
- **SO lines (ADR-0012):** total metres + optional length mix + derived roll count + `allow_cut`.
- **Price unit (ADR-0013):** **per metre** at 44″ (owner confirmed). Line amount = billed metres × rate/m.
- **Roll cutting (ADR-0018):** a cut at picking creates a child roll with a new barcode and per-metre cost. The parent keeps its barcode with a shorter length and gets its label reprinted. Settings define a minimum remnant length.
- **E-invoicing (ADR-0011):** turnover is above ₹5 Cr, so the IRN is **mandatory**.
  - Built in Stage 3 through the `EInvoiceProvider` adapter (NIC sandbox for dev/CI).
  - A final SI PDF prints only once its IRN exists.
- **Credit exposure at confirm (ADR-0016):** includes this SO. Implement OVER_LIMIT / OVER_DUE (credit days + grace) / BOTH.
- **Partial return (ADR-0015):** keeps the roll identity → Returned → inspection → Scrap / Mapped with the new length.
- **GST (ADR-0008, 0009, 0010):**
  - No GST in landed cost.
  - Tax invoice for unregistered/composition buyers; Bill of Supply only as an opt-in.
  - TCS flag is reserved.
  - *(Proposed — the CA review was deferred by the owner. Build to these defaults, keep each behind Settings, and re-raise before Stage 3 sign-off.)*
- **Legacy roll allocation algorithm is kept** (port matrix 2.1): FIFO full-length rolls, then longest remnants, greedy fit, then swap optimisation.

## Design system: "Editorial Ledger" (brief Part B)

- **Not a dashboard look:**
  - no KPI-tile grids, gradients, rainbow icons, or saturated pills
  - documents render as paper **sheets**, with status, timeline, audit, and actions in a right **margin column**
  - split view: a ruled register on the left, the sheet on the right
- **Tokens (light / dark):**

  | Token | Light | Dark |
  |---|---|---|
  | `--paper` | `#FBF8F2` | `#14171C` |
  | `--sheet` | `#FFFFFF` | `#1A1E24` |
  | `--ink` | `#1B2433` | `#E8E4DA` |
  | `--ink-2` | `#4F5866` | `#A3A9B3` |
  | `--rule` | `#E6DFD2` | `#2A2F37` |
  | `--accent` (oxblood) | `#7A2E2E` | `#D08A7A` |
  | `--positive` | `#2F6B4F` | `#7FC4A0` |
  | `--caution` | `#8A5F0E` | `#E0B35A` |
  | `--critical` | `#A23B2A` | `#E5806E` |
  | `--info` | `#2B5C8A` | `#86B3DD` |

- **Type:**
  - Newsreader for titles and document headings
  - Inter with `tnum` and `lnum` for UI
  - JetBrains Mono for barcodes, document numbers, GSTINs
  - Fonts are self-hosted.
- **Layout:** 4-pt grid; radius 2–4px; 1px hairline rules instead of cards. Motion 120–180 ms; respect reduced motion.
- **Number formatting:**
  - Indian digit grouping (₹ 4,82,300.00).
  - Tabular figures, right-aligned.
  - Negatives in parentheses.
  - Units always shown (`1,000 m`, `44″`).
- **Keyboard first:**
  - ⌘/Ctrl K command palette.
  - `?` shortcut overlay.
  - Enter moves to the next field in line grids.
  - `A` add line, `P` post, `Esc` back.
  - Comfortable / Compact density.
- **Home is "Today":**
  - a written brief, then a "Needs you" worklist, then quiet visx charts (sales trend, AR waterfall, stock aging heatmap)
  - role-filtered
- **Warehouse PWA at `/floor`:** large type; camera + keyboard-wedge scanning; offline-tolerant.
- **Accessibility:** WCAG AA in both themes; visible focus; axe checks in CI.

## Working agreement

- **Planning:**
  - Plan each stage (schema, endpoints, screens, tests) and wait for approval before coding.
  - Ask when a business rule is ambiguous. Never guess.
- **Git:**
  - One branch per stage; small commits.
  - Never commit or push without the owner's go-ahead.
  - Never modify `../erp_api` or `../erp_web_app`.
- **Tests:**
  - Characterisation tests come first when porting legacy logic.
  - Domain coverage ≥ 90%.
  - The stage's PRD §11 UAT scripts run as Playwright E2E.
- **Performance budgets (measured on seeded data, ≥ 50k rolls):**
  - list p95 < 300 ms
  - credit check < 1 s
  - scan lookup < 500 ms
  - Today < 1.5 s
- **Docs:** record every non-obvious choice as an ADR (`docs/decisions/NNNN-*.md`, template `0000`). Keep module READMEs and `docs/open-questions.md` current.

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install everything |
| `pnpm setup:local` | Create `.env` with generated secrets and the seed Owner password |
| `pnpm db:up` / `pnpm db:down` | Start/stop Postgres 17, Redis 7, MinIO, Mailpit (Docker Compose) |
| `pnpm db:reset` | Drop, migrate and seed the local database |
| `pnpm dev` | API :3000, worker, web :5173 (proxy `/api` → API) |
| `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test` | Repo-wide checks |
| `pnpm test:int` | API integration tests (Testcontainers; needs Docker) |
| `pnpm test:e2e` | Playwright gate + accessibility (`E2E_PUBLIC_ONLY=1` for no-API pages only) |
| `pnpm api:gen` | Export OpenAPI and regenerate the typed client (after API changes) |
| `pnpm --filter @erp/db generate` | New Drizzle migration after schema changes |

Machine prerequisites (ADR-0019, ADR-0020): Docker Desktop with WSL2, Node 24 LTS, pnpm 11.
