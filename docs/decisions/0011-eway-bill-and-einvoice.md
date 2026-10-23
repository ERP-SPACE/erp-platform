# 0011 — E-invoicing (IRN) is mandatory and moves into Stage 3; e-way bill alongside

- **Status:** Accepted — owner confirmed annual turnover **above ₹5 crore** (2026-10-23)
- **Date:** 2026-10-23

## Context
- **E-invoicing:** mandatory for aggregate annual turnover above ₹5 Cr. Every B2B tax invoice, credit note, and debit note (including SEZ and exports) must be reported to the IRP and carry an IRN and a signed QR code. The PRD deferred this to Phase 2, which is no longer legally possible.
- **E-way bill:** required for movements of goods worth over ₹50,000. It can be generated from the IRN.

## Decision
- **Interface:** an `EInvoiceProvider` adapter in the `compliance` module (new), with three implementations:
  1. `SandboxProvider`: the NIC sandbox, used in local dev and CI.
  2. A GSP/IRP provider: chosen later (open question Q27).
  3. `ManualProvider`: an emergency fallback that records an IRN generated on the portal by hand.
- **Flow:**
  - SI posting (B2B / SEZ) enqueues IRN generation (BullMQ, retries with backoff). The SI stores `irn`, `ack_no`, `ack_date`, `signed_invoice`, `signed_qr`, and `einvoice_status` (`Pending | Generated | Failed | Cancelled`).
  - The final invoice PDF prints only once the IRN exists. Before that it is watermarked "Provisional — IRN pending".
  - The same applies to credit notes and debit notes.
- **B2C invoices** (unregistered buyers) do not need an IRN.
- **Cancelling an IRN:**
  - Allowed only within 24 h via the IRP. It also cancels the SI internally, and the number is not reused.
  - After 24 h, the only correction is a credit note.
- **Reporting deadline:** for turnover of ₹10 Cr or more, invoices must be reported to the IRP within 30 days of the invoice date (verify the current rule with the CA). The system warns on drafts older than 25 days and blocks posting beyond the limit.
- **E-way bill:**
  - The DC captures transporter (FK), transporter GSTIN/ID, vehicle number, LR number and date, distance (km), and the e-way bill number/date.
  - If an IRN exists, the e-way bill is generated from it (Part A + Part B via the provider). Otherwise it is entered manually.
- **Stage impact:** Stage 3 gains the compliance module plus sandbox tests. The Stage 3 gate includes IRN generation against the NIC sandbox.
