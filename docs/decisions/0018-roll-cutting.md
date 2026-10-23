# 0018 — Roll cutting at dispatch

- **Status:** Accepted — owner confirmed "rolls are cut sometimes" (2026-10-23)
- **Date:** 2026-10-23

## Context
Customers sometimes buy part of a roll (e.g. 600 m from a 1000 m roll, keeping 400 m in stock). The legacy allocation algorithm assumed rolls are never cut, and the PRD has no cut operation. Each cut must keep barcode lineage (KPI ≥ 99.9%), exact per-metre costing, and a correct physical label on both pieces.

## Decision

**Data:**
- `rolls.parent_roll_id` (nullable).
- A `roll_cuts` table: `id, parent_roll_id, child_roll_id, cut_m, waste_m, parent_length_before, parent_length_after, dc_id, so_line_id, by, at, reason`.

**Cut operation** (one transaction, warehouse permission `inventory.roll.cut`):
1. Lock the parent (`FOR UPDATE`). It must be **Mapped**, and `cut_m + waste_m` must be less than `parent.current_length_m`.
2. Create a **child roll**:
   - It gets a new barcode from the parent's batch sequence and the same SKU, batch, and supplier as the parent.
   - `length = cut_m`; `landed_cost_total = cut_m × parent.landed_cost_per_m` (decimal, largest remainder against the parent's remaining cost).
   - Status Allocated when cut for a DC, otherwise Mapped.
3. Update the parent: `current_length_m -= cut_m + waste_m`, and reduce its landed cost by the same per-metre amount. It stays **Mapped** with the same barcode and is flagged `label_reprint_due`.
4. If `waste_m > 0` (trim loss), write a `ROLL_SCRAPPED` posting event for the waste value, with reason "cut waste".
5. The UI immediately offers to print the child's label and reprint the parent's label (new length).

**Remnant rule:** if a cut would leave the parent below `min_usable_length_m` (Settings, default 100 m), the UI warns and offers to send the whole roll instead, or to cut and scrap the remainder.

**Allocation algorithm** (extends the ported legacy algorithm, port matrix 2.1):
1. Run the legacy passes unchanged: FIFO full-length rolls, then longest remnants, greedy fit without cutting, swap optimisation.
2. If the shortfall is still above tolerance **and** `so_line.allow_cut`, suggest one cut. The source roll is chosen in this order:
   1. Existing remnants (non-standard length) whose length ≥ shortfall, choosing the one leaving the **smallest leftover** that is either 0 or ≥ `min_usable_length_m`.
   2. Otherwise the oldest standard roll.
3. Never suggest more than one cut per line. Staff can override at picking.

**Billing and COGS:**
- The SI bills `shipped_length_m × rate_per_m`.
- COGS = the child roll's landed cost, so the existing COGS rule (Σ landed cost of billed rolls) is unchanged.

**Returns:** a returned cut piece follows ADR-0015 on the child roll.

**Lineage:** the Roll Inspector shows the parent → children tree with each cut's DC and SO.

## Consequences
- Every physical piece always has its own barcode. Stock metres and stock value stay exact to the paisa.
- Reports gain "cut frequency" and "cut waste" metrics (Stage 5).
