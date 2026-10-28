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

## Implementation notes (Stage 3 step 5, 2026-10-28)
- **Providers:** `NicProvider` speaks the NIC protocol (auth v1.04 with RSA-wrapped credentials and an AES session key; IRN, cancel and e-way bill on v1.03). It is used when all `NIC_*` env vars are set; the sandbox's registered GSTIN replaces the seller GSTIN on sandbox calls. Without credentials a `SimulatorProvider` issues IRNs offline (SHA-256 of GSTIN + FY + type + number, the IRP's own formula) with unsigned JWT-shaped QR data marked SIMULATED — dev and CI only.
- **Settings `einvoice.config.provider`:** `SANDBOX` uses the above; `MANUAL` stops calls (IRNs are recorded by hand); `GSP` fails clearly until Q27 is answered.
- **Statuses:** `Pending` = queued or retrying after an outage (automatic); `Failed` = rejected by the IRP or our own pre-checks (`validateEInvoice`) — a person fixes the data and retries, or records a portal IRN by hand (reason required); `Generated`; `Cancelled`; `NotRequired` for B2C and cancelled-before-reporting documents.
- **Payload** is built from what was stored at posting (line values and taxes, party snapshot), so the IRP's totals equal ours; structured addresses come from the company and customer masters.
- **Cancelling** a posted SI or note calls the IRP last inside the same transaction: if the IRP refuses, nothing is cancelled (the refused call is still logged). The 24 h window counts from the IRN's ack time.
- **E-way bill** is generated from the IRN on the SI and copied to its challans; a manual entry path exists. No consignment-value check blocks it (generating one below ₹50,000 is allowed).
- **Gate:** the step-9 gate runs against the real NIC sandbox once Q27 credentials exist; until then tests use the simulator and a fake IRP that checks the encryption.
