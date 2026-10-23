# Roadmap

Development happens **locally first** (Docker Compose). AWS comes after local UAT sign-off (ADR-0019).

| Stage | Scope | Status |
|---|---|---|
| Part A | CLAUDE.md, legacy port matrix, ADRs, open questions | Done (2026-10-23) |
| 0 | Foundation: monorepo, Docker Compose, CI (no deploy), auth/RBAC, audit, settings, document series, design system, app shell | Ready to start once Docker + `gh` are installed (Q4a) |
| 1 | Masters: catalogue, suppliers, transporters, customers (`allow_cut`, GST profile), credit policy, per-metre party rates, salesmen, commission rules | Needs Q6–Q11 |
| 2 | Purchase & inventory: PO, GRN + barcodes, unmapped staging, PI, landed cost, purchase returns, Roll Inspector, roll cutting primitives, `/floor` | Not started |
| 3 | Sales + **e-invoicing**: pricing engine, SO + credit check, Sales Board, DC picking with cuts, SI + IRN (NIC sandbox), e-way bill, proforma, direct invoice, sales returns, CN/DN with IRN | Needs Q19–Q22, Q27, Q28; CA defaults (Q18) re-raised |
| 4 | Collections, credit, commission | Not started |
| 5 | Reports, analytics, Today brief, pivot builder (adds cut frequency/waste) | Not started |
| 6 | Opening balances, hardening, local UAT sign-off | Not started |
| 7 | Cloud deployment: Terraform, AWS ap-south-1 (ECS, RDS, ElastiCache, S3, CloudFront), stage + prod, restore drill, go-live | Not started |
| Later A | Accounting: CoA; voucher engine back-filled from `posting_events`; double-entry enforced by a deferred constraint trigger (Σ Dr = Σ Cr per voucher); posted vouchers immutable; ledger browser; GST summary | Deferred |
| Later B | WhatsApp: channel adapter on the `notifications` outbox | Deferred |
