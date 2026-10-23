# 0007 — Barcode format `YYMM-SUP-BATCH-SEQ-CHECK`

- **Status:** Accepted
- **Date:** 2026-10-23

## Context
PRD §5.3 says `SEQ`; §6.1 says `ROLLID`. The legacy check digit (ASCII sum mod 10) misses transposed characters, and its SEQ came from `countDocuments`, which races.

## Decision
- **Format:** `YYMM-SUP-BATCH-SEQ-CHECK`, e.g. `2610-SHR-0042-0007-K`.
  - `YYMM`: GRN posting month.
  - `SUP`: 3-character supplier short code (unique, set on the supplier master).
  - `BATCH`: 4-digit per-supplier batch sequence.
  - `SEQ`: 4-digit per-batch roll sequence, allocated under a row lock.
  - `CHECK`: one character from Luhn mod-36 over the alphanumerics.
- **Internal identity:** the roll UUID stays internal and never appears on the label.
- **Reprints:** allowed at any time, logged to `label_prints`. The barcode never changes, even when the length changes (ADR-0015).
