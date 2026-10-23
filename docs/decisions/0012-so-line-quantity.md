# 0012 — SO line holds metres, roll count, an optional length mix, and a cut permission

- **Status:** Accepted
- **Date:** 2026-10-23

## Context
The PRD SO line is `qty_rolls × length_m_per_roll`. The legacy system ordered by **total metres** with "bifurcations" (e.g. 3 × 1000 m + 2 × 1500 m) and allocated rolls by metres. The owner confirmed that pricing is per metre (ADR-0013) and that rolls are sometimes cut (ADR-0018).

## Decision
- **SO line fields:**
  - `sku_id`, `width_in`, `total_m`
  - `length_mix` (jsonb array of `{length_m, rolls}`; optional — default is one entry using the product's default length)
  - `qty_rolls` (derived), `allow_cut` (default from the customer, else Settings)
  - `rate_per_m`, `override_rate_per_m`, `tax_rate`
- **Allocation:** works in metres (ported algorithm + cut step, ADR-0018). DC lines are per roll with `shipped_length_m`.
- **Backorders:** tracked in metres and rolls.
