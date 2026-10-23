# 0003 — Gapless, FY-reset document numbering; SI numbered on posting

- **Status:** Accepted (format chosen by engineering at the owner's request, 2026-10-23)
- **Date:** 2026-10-23

## Context
GST requires tax invoice numbers to be consecutive, unique per financial year, and at most 16 characters (only `/` and `-` allowed as special characters). The legacy approach (regex-max + 1) is race-prone. The owner delegated the format choice.

## Decision
- **Format:** `{TYPE}/{FY}/{SEQ}`, with `{FY}` = `2627` for FY 2026-27 (April–March), a 5-digit zero-padded sequence, and a reset every 1 April. Example: `SI/2627/00001` (13 characters, leaving headroom under the GST limit).

| Document | Type code | Example | Numbered on |
|---|---|---|---|
| Purchase Order | PO | `PO/2627/00001` | creation |
| Goods Receipt Note | GRN | `GRN/2627/00001` | creation |
| Purchase Invoice (internal ref) | PI | `PI/2627/00001` | posting |
| Purchase Return | PR | `PR/2627/00001` | posting |
| Debit Note | DN | `DN/2627/00001` | posting |
| Sales Order | SO | `SO/2627/00001` | creation |
| Proforma Invoice | PF | `PF/2627/00001` | creation |
| Delivery Challan | DC | `DC/2627/00001` | creation |
| Sales Invoice | SI | `SI/2627/00001` | **posting** |
| Sales Return | SR | `SR/2627/00001` | posting |
| Credit Note | CN | `CN/2627/00001` | **posting** |
| Receipt | RC | `RC/2627/00001` | posting |
| Payment | PY | `PY/2627/00001` | posting |
| Voucher (later stage) | JV | `JV/2627/00001` | posting |

- **Master codes** (not FY-reset): `CUST-0001`, `SUP-0001`, `SLS-0001` (salesman), `TRN-001` (transporter). Every supplier also gets a 3-character barcode short code (ADR-0007).
- **The supplier's own invoice number** is stored on the PI as `supplier_invoice_no`, unique per (supplier, FY). Duplicate entry is blocked.
- **Storage:** a `document_sequences` table holds `(entity_type, fy, prefix_template, padding, current_seq, reset_on_fy)`. All of the above are editable in Settings with a live preview. GST documents are validated to 16 characters or fewer.
- **Allocation:** inside the posting transaction with `SELECT … FOR UPDATE`. Postgres SEQUENCEs are not used, because they leave gaps on rollback.
- **SI / CN / DN** get their number **on posting**. Drafts display `DRAFT-<short id>`, so a cancelled draft never burns a number.
