# 0008 — Input GST is not capitalised into landed cost

- **Status:** Proposed — **confirm with the company's CA**
- **Date:** 2026-10-23

## Context
The PRD Landed Cost `type` enum includes `GST`. For a regular GST-registered trader, input GST on purchases (and on freight/clearing services) is claimable input tax credit. Capitalising it into inventory would overstate stock value and COGS, and double-count it against the Input GST ledger.

## Decision
- Landed-cost components: Freight, Duty, Clearing, Misc.
- GST on those service bills is captured as input tax on the cost bill, not added to roll cost.
- A hidden admin flag `capitalise_ineligible_gst` allows the `GST` component **only** for ineligible ITC, e.g. blocked credits under s.17(5).
