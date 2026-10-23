# 0013 — Price unit: per metre at 44″

- **Status:** Accepted — owner confirmed "per metre" (2026-10-23)
- **Date:** 2026-10-23

## Context
The PRD formula `derived_rate(W) = base_rate_44 × W/44` and its ₹2,200 → ₹1,800 example read like a per-roll rate, while the legacy app priced per metre. The owner confirmed that prices are quoted **per metre**.

## Decision
- **Rates:** `base_rate_44` (party rate, deal rate, salesman default rate) is stored **per metre** at 44″. `derived_rate_per_m(W) = base_rate_44 × W / 44`, rounded per Settings.
- **Line amount:** `billed_m × rate_per_m`. This works naturally for odd lengths and cut rolls (ADR-0018).
- **Documents** show rate/m. For readability, the SO/SI line also shows the equivalent amount per roll for the line's length mix.
- **Override tolerance** compares per-metre rates. Bulk revision changes the per-metre rate (₹ or %), as in PRD §6.4.
- **Commission `PER_METER`** uses billed metres.
- **The PRD example** is read as ₹/m × width ratio. The formula itself is unchanged.
