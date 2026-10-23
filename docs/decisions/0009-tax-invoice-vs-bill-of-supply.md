# 0009 — Tax invoice to unregistered/composition buyers; Bill of Supply as an opt-in template

- **Status:** Proposed — **must be confirmed with the company's CA before Stage 3**
- **Date:** 2026-10-23

## Context
PRD §8.6 says "Composition and Unregistered → Bill of Supply (no tax line)". Under GST, a **regular** registered supplier must charge GST on taxable supplies whatever the buyer's registration status. A Bill of Supply is issued for exempt supplies or by a *composition-scheme seller*. Composition buyers simply cannot claim the ITC.

## Decision
- **Regular, Composition, and Unregistered buyers** all receive a **tax invoice**:
  - Unregistered buyers are reported as B2C; the invoice still shows GST.
  - Composition buyers are reported as B2B with their GSTIN; GST is still charged.
- **SEZ buyers:** a zero-rated tax invoice — IGST 0% with the LUT reference, or IGST paid with a refund claim (configurable per customer).
- **Bill of Supply:** a separate document template and number series that is **off by default**. It can be enabled for exempt items if the business ever sells them.
- **Customer `gst_type`:** drives GSTR-1 classification (B2B / B2CL / B2CS / SEZ) instead of suppressing tax.
