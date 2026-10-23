# 0022 — UI direction: professional dashboard (supersedes brief Part B)

- **Status:** Accepted — owner decision, 2026-10-23
- **Date:** 2026-10-23

## Context
Stage 0 shipped the "Editorial Ledger" design from the brief (Part B): ivory paper, serif headings, a written "Today" brief and a text-only navigation rail. On seeing it, the owner said it looks "very childish" and asked for a dashboard-style UI that is professional and elegant. Offered three directions, the owner chose **Clean SaaS**.

## Decision
- **Visual language:**
  - white cards on a light grey canvas
  - collapsible icon sidebar
  - KPI stat cards
  - dense data tables
  - Inter + JetBrains Mono
  - one deep-blue primary
  - soft status pills
  - dark theme as an equal option
- **Component set** in `packages/ui`: `PageHeader`, `Card`, `StatCard`, `DataTable`, `Drawer`, `FormSection`, `Tabs`, `Badge`, `DropdownMenu`, `Tooltip`, `Avatar`, `ActivityFeed`, `Stepper`, plus the restyled fields, dialogs, toasts and command palette.
- **Removed:** `Sheet`, `MarginNote`, `Timeline`, `Register`, `Rule`, `StatusMark`, `PageTitle`; the Newsreader font.
- **Contrast:** every token pair is checked at ≥ 4.5:1 in both themes; axe runs in CI.

## Consequences
- Brief Part B and the earlier `CLAUDE.md` design section are superseded; `CLAUDE.md` now describes this system.
- Documents (invoices, challans) will still print as formal A4 PDFs; on screen they use the card/table language above.
- The "Today" written brief becomes a conventional dashboard: KPIs, setup checklist, recent activity; charts arrive in Stage 5.
