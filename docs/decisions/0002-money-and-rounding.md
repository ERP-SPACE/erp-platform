# 0002 — Money, quantities and rounding

- **Status:** Accepted
- **Date:** 2026-10-23

## Decision
- **Storage types:** `numeric(14,2)` for amounts, `numeric(12,4)` for rates, `numeric(10,2)` for metres, `numeric(5,2)` for inches.
- **Arithmetic:** all of it goes through `packages/domain/money.ts` (decimal.js). JS `number` is never used for money.
- **Splitting amounts:** every split (bill discount → lines, landed cost → rolls, GST → CGST/SGST halves) uses **largest-remainder** rounding to the paisa. The parts always sum exactly to the whole.
- **Invoice round-off:** to the nearest ₹1 (configurable), shown as a separate "Round off" line.
- **Property tests:** `fast-check` tests assert that the parts always sum to the whole for random inputs.
