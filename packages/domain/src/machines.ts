import { defineMachine } from "./state.js";

/**
 * Stage 2 state machines (PRD §7, ADR-0014/0015/0017). Services call `assert(from, to)` before
 * every status change and log it to `status_transitions`; the DB also CHECKs the status column.
 */

export const ROLL_STATUSES = [
  "Unmapped",
  "Mapped",
  "Allocated",
  "Dispatched",
  "Returned",
  "ReturnedToSupplier",
  "Scrap",
] as const;
export type RollStatus = (typeof ROLL_STATUSES)[number];

/**
 * Roll lifecycle. Rolls are born at GRN posting as Mapped (SKU known) or Unmapped (ADR-0017).
 * - Allocated: picked onto a draft DC (ADR-0014); un-picking returns it to Mapped.
 * - Returned: back from a customer, awaiting inspection → Mapped or Scrap (ADR-0015).
 * - ReturnedToSupplier and Scrap are final.
 */
export const rollMachine = defineMachine<RollStatus>("Roll", {
  Unmapped: ["Mapped", "Scrap", "ReturnedToSupplier"],
  Mapped: ["Allocated", "Scrap", "ReturnedToSupplier"],
  Allocated: ["Mapped", "Dispatched"],
  Dispatched: ["Returned"],
  Returned: ["Mapped", "Scrap"],
  ReturnedToSupplier: [],
  Scrap: [],
});

/** Rolls that count as stock on hand (sellable or about to be). */
export const IN_STOCK_ROLL_STATUSES: readonly RollStatus[] = ["Unmapped", "Mapped", "Allocated"];

export const PO_STATUSES = [
  "Draft",
  "Approved",
  "PartiallyReceived",
  "Closed",
  "Cancelled",
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

/** Purchase order. Cancelling is only possible before anything is received. */
export const purchaseOrderMachine = defineMachine<PoStatus>("PurchaseOrder", {
  Draft: ["Approved", "Cancelled"],
  Approved: ["PartiallyReceived", "Closed", "Cancelled"],
  PartiallyReceived: ["Closed"],
  Closed: [],
  Cancelled: [],
});

export const GRN_STATUSES = ["Created", "Posted", "Cancelled"] as const;
export type GrnStatus = (typeof GRN_STATUSES)[number];

/** Goods receipt. Posting creates rolls + barcodes; no edits afterwards (PRD §7). */
export const grnMachine = defineMachine<GrnStatus>("GoodsReceipt", {
  Created: ["Posted", "Cancelled"],
  Posted: [],
  Cancelled: [],
});

export const PI_STATUSES = ["Draft", "Posted", "Cancelled"] as const;
export type PiStatus = (typeof PI_STATUSES)[number];

/** Purchase invoice. Posting fixes roll base cost and writes PI_POSTED (ADR-0017). */
export const purchaseInvoiceMachine = defineMachine<PiStatus>("PurchaseInvoice", {
  Draft: ["Posted", "Cancelled"],
  Posted: [],
  Cancelled: [],
});

export const PURCHASE_RETURN_STATUSES = ["Draft", "Posted", "Cancelled"] as const;
export type PurchaseReturnStatus = (typeof PURCHASE_RETURN_STATUSES)[number];

/** Purchase return; posting moves its rolls to ReturnedToSupplier and issues the debit note. */
export const purchaseReturnMachine = defineMachine<PurchaseReturnStatus>("PurchaseReturn", {
  Draft: ["Posted", "Cancelled"],
  Posted: [],
  Cancelled: [],
});
