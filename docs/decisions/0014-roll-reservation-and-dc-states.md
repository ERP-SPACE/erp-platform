# 0014 — When a roll becomes Allocated; DC lifecycle

- **Status:** Accepted
- **Date:** 2026-10-23

## Context
The PRD has a roll state `Allocated` and DC states `Open → Closed`. In the legacy build, allocation was only advisory on the SO, and rolls were locked at DC posting.

## Decision
- **SO save/confirm:** runs the allocation algorithm as a **suggestion** only (no lock). Confirmed SOs show availability. OnHold SOs never reserve stock (PRD §7).
- **Picking (draft DC):**
  - Scanning or selecting a whole roll onto a **draft DC** moves it Mapped → **Allocated** (with `FOR UPDATE SKIP LOCKED`).
  - A **cut** at picking creates an Allocated child roll and shortens the parent (ADR-0018).
  - Removing a whole roll from the draft, or cancelling the draft, moves it back to Mapped. A cut child roll becomes a Mapped remnant — it cannot be un-cut.
- **DC lifecycle:**
  - **Draft** (picking) → **Open** (posted: rolls → Dispatched, SO quantities updated, `DC_POSTED` event) → **Closed** (auto, when fully invoiced).
  - `Draft` is an internal pre-state not shown in the PRD's Open/Closed list.
