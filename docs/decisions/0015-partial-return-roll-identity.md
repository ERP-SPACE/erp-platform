# 0015 — Partial returns keep the roll identity

- **Status:** Proposed — owner may prefer the legacy "child roll" approach
- **Date:** 2026-10-23

## Context
- **Legacy:** on a return, the legacy build zeroed the original roll and created a **new child roll** for the remaining metres, directly in Mapped (skipping inspection, and discarding returns under 100 m).
- **PRD:** Returned → inspection → Scrap or re-Mapped with the updated length.

## Decision
- **Sales return posting:**
  - The **same roll** (same barcode) moves Dispatched → Returned.
  - `current_length_m` = the measured returned length.
  - `landed_cost` = the partial-COGS value (PRD §6.3).
- **Inspection** then sends it to Scrap (write-off event) or Mapped. It can be re-mapped to a different SKU if needed.
- **Labels:** reprint, since the length on the label changed.
- **History:** every length change is kept in `roll_length_adjustments`.
- **Minimum length:** a configurable minimum usable length (default 100 m, carried from legacy) only **suggests** Scrap at inspection.
