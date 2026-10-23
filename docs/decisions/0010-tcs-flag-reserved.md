# 0010 — `tcs_applicable` kept as a reserved flag

- **Status:** Proposed — **confirm with the CA**
- **Date:** 2026-10-23

## Context
TCS on sale of goods under s.206C(1H) was omitted by the Finance Act 2025 with effect from 1 April 2025. The PRD still asks for the flag, with computation in Phase 2.

## Decision
- Keep `customers.tcs_applicable` (default false), labelled "Reserved — TCS on sale of goods withdrawn from 1 Apr 2025" in the UI.
- Build no computation.
- Revisit if the CA indicates another TCS provision applies.
