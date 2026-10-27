# Stage 2 — Purchase & Inventory: implementation plan

**Status:** awaiting owner approval · **Branch:** `stage-2-purchase-inventory` (from `main` + Stage 1 corrections)

## What Stage 2 delivers

Paper comes in from a supplier, every roll gets a barcode label, its true cost becomes known (purchase rate plus freight, duty and other charges), and you can see what stock you hold.

**The everyday flow:**

1. **Purchase order (PO):** what you order from Shree Balajee, Orange O Tec, etc.
2. **Goods receipt (GRN):** the truck arrives. You enter the rolls exactly as the supplier lists them, e.g. `10 x 1000` or `4 x 1000, 500, 450`.
   - Each roll gets its own barcode label.
   - The supplier's lot number (e.g. `CONT-13`) is kept.
3. **Mapping:** rolls whose product isn't known yet (a new width or quality) wait as **Unmapped**. Someone assigns them to a product, or creates the product on the spot.
4. **Purchase invoice (PI):** the supplier's tax invoice is entered and linked to the received rolls. It fixes their base cost; CGST/SGST or IGST follows the supplier's state.
5. **Landed cost:** freight, loading, insurance, duty etc. are spread over the rolls of that invoice. Each roll ends up with its true cost per metre, which Stage 3 uses for margin and COGS.
6. **Inventory:**
   - stock by product, lot and supplier
   - ageing, and dead stock (over 180 days)
   - the **Roll Inspector**: scan a roll to see its whole history
   - scrap a roll
   - reprint a label
7. **Purchase return + debit note:** send damaged rolls back to the supplier.
8. **Godown phone app (`/floor`):** receive, scan, map and inspect rolls with a phone camera or a USB scanner.

## What your invoices taught us (built in)

- **Supplier prices also follow the 44″ rule.** For example, Shree Balajee: ₹4.90 at 44″ and ₹6.68 at 60″, both from the same 44″ rate. PO lines therefore get a "₹/m at 44″" helper that fills each width's rate.
  - Each line still stores the per-metre rate the supplier actually charges, because suppliers round differently.
- **Roll lengths:** the supplier's lengths are trusted (Q13). There is no re-measure step, though a wrong length can still be corrected with a reason.
- **Lots:** lots like `CONT-13` are recorded as the supplier's batch reference. The barcode keeps our own short batch number (ADR-0007).
- **Big invoices:** single invoices can carry hundreds of rolls (7 lakh metres). The GRN's roll entry and label printing are built for bulk.

## Your answers applied

| Topic | Decision |
|---|---|
| Labels & scanner (Q12) | Default: **PDF labels, 100 × 50 mm**, printable on any printer (one label per page, or 2 × 5 on A4 sheets). Each label shows the barcode + QR, product, width, GSM, length and lot — **never cost** (ADR-0006). A thermal printer (ZPL) can be switched on in Settings later. Any USB scanner works, because it types like a keyboard; phones use the camera. |
| Godown locations (Q15) | Not tracked. Rolls only carry a status. |
| Landed cost (Q16) | Industry-standard split, editable in Settings (below). |
| Supplier invoice before goods (Q14 — not answered yet) | **Both orders are supported.** A PI can be entered before the goods arrive; it links to the rolls when the GRN is posted. Nothing is lost if this turns out to be rare. |

## Landed-cost split (default, editable in Settings → Purchase)

| Charge | Default split across rolls | Why |
|---|---|---|
| Freight / transport inward | **By weight** | Trucks charge by load; heavier (higher GSM, wider, longer) rolls take more of it |
| Loading / unloading (hamali) | **By weight** | Labour scales with weight |
| Insurance | **By value** | Insured on invoice value |
| Customs duty (imports: BCD + SWS) | **By value** | Assessed on value |
| Clearing & forwarding (CHA), port/CFS | **By value** | Usual trade practice for imported containers |
| Brokerage / commission on purchase | **By value** | A percentage of purchase value |
| Other | **By value** | Safe default |

- **Weight** is computed, not typed: GSM × width × length (a 1000 m roll of 29 GSM at 44″ weighs about 32 kg). This is fairer across mixed widths and GSMs than metres alone. **Metre** and **equal per roll** are also available, matching the PRD's ROLL/METER/VALUE options, with weight added.
- **GST is never part of landed cost** (ADR-0008); it is input tax credit.
- **Preview first:** every charge shows its split before it is applied.
- **Exact totals:** amounts are split with the largest-remainder method, so the rolls sum to the charge to the paisa.
- **Already-dispatched rolls:** a correction after rolls have left goes to a variance record rather than changing their cost (ADR-0017).

## Build steps (one commit each; you see screens at step 6)

1. **Domain (pure logic, unit-tested ≥ 90 %):**
   - roll state machine: Unmapped → Mapped → Allocated → Dispatched → Returned → Mapped/Scrap; ReturnedToSupplier
   - PO / GRN / PI / purchase-return state machines
   - barcode with Luhn mod-36 check character
   - roll quick-entry parser (`4x1000, 500, 450`)
   - roll weight from GSM × width × length
   - landed-cost allocator (roll / metre / value / weight, largest remainder)
   - purchase-line maths with CGST/SGST vs IGST
2. **Contracts:**
   - permissions: `purchase.*`, `inventory.*`, `labels.print`; `purchase.over_receipt.approve` needs step-up + reason
   - new settings: landed-cost charge types and their split; GRN over-receipt tolerance (default 0 %); label layout
   - schemas for every endpoint
3. **Database:**
   - purchase orders and lines
   - GRNs and lines; batches (per-supplier sequence) with the supplier's lot reference
   - **rolls**: original and current length, base cost/m, landed cost/m, status, barcode unique
   - roll links to the PI
   - label print log
   - purchase invoices and lines
   - landed-cost charges and per-roll allocations
   - purchase returns and debit notes
   - `posting_events` for PI, purchase return, scrap and landed cost
   - stock materialized views (by product, lot and supplier; ageing; unmapped age; dead stock), refreshed every 3 min in business hours (ADR-0005)
   - audit triggers on all new tables
4. **API:**
   - **PO:** draft → approve → close/cancel
   - **GRN:** partial receipts; accepted/rejected quantities; over-receipt blocked unless approved
   - **posting:** creates rolls + barcodes in one transaction (ADR-0017)
   - **mapping:** bulk map Unmapped rolls, with inline product creation
   - **PI:** with or without a PO line (a reason is required without one)
   - **landed cost:** preview + apply
   - **purchase return + debit note**
   - **rolls:** inspector, scrap (reason + cost event), length correction
   - **labels:** PDF (and ZPL text)
   - integration tests
5. **Worker:**
   - label PDF generation for large batches
   - materialized-view refresh job
6. **Web, office screens:**
   - Purchase (PO list/form with the 44″ helper; GRN with bulk roll entry and lot reference; PI; landed-cost wizard with preview)
   - Inventory (stock summary, Unmapped staging, Roll Inspector, scrap, reprint)
   - dashboard KPIs (unmapped rolls, stock value)
   - **→ screenshots to you for review**
7. **Web, godown app `/floor`:**
   - large-type phone screens: receive against a GRN, scan → map, scan → inspect
   - camera and USB scanner support; tolerant of brief network drops
8. **Gate:**
   - PRD UAT §11.1 and §11.2 as Playwright tests (excluding the sales-return item, which is Stage 3)
   - a property test that landed cost per roll always sums to the charge to the paisa
   - axe in light and dark
   - docs; full run on the isolated E2E stack

## Gate (brief)

- **PRD UAT §11.1:** create a PO for 3 products → partial GRN → Unmapped rolls appear → bulk-map → raise PI → landed cost by metre → every roll's landed cost is correct.
- **PRD UAT §11.1, over-receipt:** a GRN above the PO is blocked; an admin approval with a reason is audited.
- **PRD UAT §11.1, PI without a PO line:** shows a warning and requires a reason.
- **PRD UAT §11.2:** scanning a roll shows its full history (supplier → lot → PI → cost); scrapping writes a cost event at landed cost.
- **Paisa check:** landed cost per roll sums to each PI charge to the paisa.

## Not in Stage 2

- Sales orders, DC picking and cutting at dispatch (Stage 3); the cutting primitives on rolls are built now.
- Accounting vouchers: the scrap write-off "voucher" in UAT §11.2 is recorded as a `ROLL_SCRAPPED` posting event now, and the voucher is generated in the later Accounting stage.
- Godown locations.
- Thermal-printer-specific tuning (until you choose hardware).
