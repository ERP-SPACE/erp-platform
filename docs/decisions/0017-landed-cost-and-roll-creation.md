# 0017 — Rolls created at GRN only; landed cost allocated once per component

- **Status:** Accepted
- **Date:** 2026-10-23

## Context
The legacy build created rolls at both GRN and PI posting, and applied landed cost twice (port matrix 3.1, 3.2).

## Decision
- **GRN posting** creates rolls (one per physical roll, with actual length), barcodes, and the batch.
  - SKU known → Mapped. Otherwise → Unmapped.
  - Base cost is taken from the PO line rate, provisionally.
- **PI posting** links to GRN rolls, fixes the base cost from the PI rate, and writes `PI_POSTED`.
- **Landed cost allocation:**
  - Each landed-cost component is allocated exactly once (`allocated = true`) across the PI's rolls, by its basis (ROLL/METER/VALUE), using largest remainder.
  - Re-running requires reversing the component first.
  - For rolls already dispatched, the delta goes to a `LANDED_COST_VARIANCE` event; their cost is not changed.
- **Each roll stores:** `base_cost`, `landed_cost_total`, `landed_cost_per_m` (= total ÷ original length). The per-metre figure drives partial-length COGS.
