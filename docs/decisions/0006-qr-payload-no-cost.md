# 0006 — QR payload carries no cost data (PRD §5.3 / §6.1 deviation)

- **Status:** Accepted
- **Date:** 2026-10-23

## Context
The PRD QR payload includes `landed_cost`. Labels travel with the goods to customers and transporters, and any phone can read a QR code. That would leak purchase cost.

## Decision
- **QR content:** the barcode string only, optionally as a short URL `https://<host>/r/<barcode>`.
- **Lookup:** all lineage and cost are fetched server-side, filtered by the scanner's role. Warehouse staff never see cost (PRD §4.1).
- **Label text:** shows GSM, quality, width, length, batch, and supplier code. **No cost.**
- **Legacy:** the legacy QR already omitted cost (`{b, s, w, l}`), so this matches existing practice.
