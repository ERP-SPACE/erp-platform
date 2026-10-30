/**
 * Permission catalogue (ADR-0021). Codes are `module.entity.action`; roles are bundles of codes.
 * A bundle may use `*` (everything) or `module.*` (everything in a module).
 * New modules add their codes here in the stage that builds them.
 */
export const PERMISSIONS = {
  "settings.view": "View settings",
  "settings.update": "Change general settings (widths, tolerances, rounding, labels…)",
  "settings.company.update": "Change the company GST profile",
  "settings.series.view": "View document number series",
  "settings.series.update": "Change document number series",
  "users.view": "View users",
  "users.manage": "Create, deactivate and edit users and their roles",
  "roles.manage": "Edit roles and the permission matrix",
  "audit.view": "View the audit log",
  // Stage 1 — masters
  "catalogue.view": "View the product catalogue",
  "catalogue.manage": "Add and edit categories, qualities, products and SKUs (incl. HSN/GST)",
  "suppliers.view": "View suppliers",
  "suppliers.manage": "Add and edit suppliers",
  "transporters.view": "View transporters",
  "transporters.manage": "Add and edit transporters",
  "customers.view": "View customers",
  "customers.manage": "Add and edit customers, contacts and addresses",
  "customers.credit.manage": "Change credit limits and block/unblock customers",
  "customers.rates.manage": "Set and revise customer rates",
  "rates.bulk_revise": "Run bulk rate revisions",
  "salesmen.view": "View salesmen",
  "salesmen.manage": "Add and edit salesmen, their defaults and KYC documents",
  "commission.manage": "Set salesman commission rules",
  "pricing.override.approve": "Approve rate overrides beyond the tolerance",
  // Stage 2 — purchase & inventory
  "purchase.view": "View purchase orders, goods receipts, purchase invoices and returns",
  "purchase.order.manage": "Create and edit purchase orders",
  "purchase.order.approve": "Approve, close and cancel purchase orders",
  "purchase.receipt.manage": "Create and post goods receipts (creates rolls and barcodes)",
  "purchase.over_receipt.approve": "Accept goods beyond the purchase order quantity",
  "purchase.invoice.manage": "Enter and post purchase invoices",
  "purchase.landed_cost.manage": "Allocate landed cost (freight, duty, insurance…) to rolls",
  "purchase.return.manage": "Create and post purchase returns and debit notes",
  "inventory.view": "View stock, rolls and the Roll Inspector",
  "inventory.view_cost": "See roll cost and stock value",
  "inventory.map": "Map unmapped rolls to products",
  "inventory.adjust": "Correct roll lengths and scrap rolls",
  "labels.print": "Print and reprint roll labels",
  // Stage 3 — sales & e-invoicing
  "inventory.roll.cut": "Cut a roll into two (new barcode for the cut piece)",
  "sales.view": "View sales orders, challans, invoices, proformas, returns and notes",
  "sales.order.manage": "Create, edit and confirm sales orders and proformas",
  "sales.credit.release": "Release an order held for credit",
  "sales.dispatch.manage": "Pick rolls onto delivery challans and dispatch them",
  "sales.invoice.manage": "Create and post sales invoices",
  "sales.invoice.cancel": "Cancel a posted invoice or note (within the IRN's 24 hours)",
  "sales.return.manage": "Receive and inspect customer returns",
  "sales.note.manage": "Issue credit and debit notes to customers",
  "compliance.einvoice.manage": "Retry or record IRNs and e-way bills by hand",
  // Stage 4 — collections, credit & commission
  "collections.view": "View customer receipts, statements and AR aging",
  "collections.receipt.manage": "Record and post customer receipts and allocate them to invoices",
  "collections.receipt.reverse": "Reverse a posted receipt or payment (cheque bounce, mistake)",
  "payables.view": "View supplier payments, statements and AP aging",
  "payables.payment.manage": "Record and post supplier payments and allocate them to invoices",
  "payables.payment.approve": "Approve supplier payments above the approval threshold",
  "commission.view": "View salesman commission entries, payouts and statements",
  "commission.payout.manage": "Create and pay commission payout batches",
  // Stage 5 — reports, analytics & Today
  "reports.view": "Open reports, the pivot builder and Today (within the user's customer scope)",
  "reports.margin.view": "See cost, COGS and margin in reports, pivots and exports (Q36)",
  "reports.pivot.share": "Share saved pivots with other roles",
  "reports.export": "Export reports and pivots as CSV, XLSX or PDF",
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

/** Actions that need a fresh login within STEP_UP_SECONDS (ADR-0021). */
export const STEP_UP_PERMISSIONS: readonly PermissionCode[] = [
  "settings.series.update",
  "users.manage",
  "roles.manage",
  "customers.credit.manage",
  "rates.bulk_revise",
  "purchase.over_receipt.approve",
  "inventory.adjust",
  "pricing.override.approve",
  "sales.credit.release",
  "sales.invoice.cancel",
  "sales.note.manage",
  "collections.receipt.reverse",
  "payables.payment.approve",
  "commission.payout.manage",
];

const MASTERS_VIEW = [
  "catalogue.view",
  "suppliers.view",
  "transporters.view",
  "customers.view",
  "salesmen.view",
] as const;

export const SYSTEM_ROLES = [
  { code: "owner", name: "Owner", grants: ["*"] },
  {
    code: "admin",
    name: "Admin",
    grants: [
      "settings.*",
      "users.view",
      "users.manage",
      "audit.view",
      "catalogue.*",
      "suppliers.*",
      "transporters.*",
      "customers.view",
      "customers.manage",
      "salesmen.*",
      "purchase.*",
      "inventory.*",
      "labels.print",
      "sales.*",
      "compliance.*",
      "collections.*",
      "payables.*",
      "commission.*",
      "reports.*",
    ],
  },
  {
    code: "purchase_manager",
    name: "Purchase Manager",
    grants: [
      "settings.view",
      "catalogue.view",
      "suppliers.*",
      "transporters.*",
      "purchase.view",
      "purchase.order.manage",
      "purchase.order.approve",
      "purchase.receipt.manage",
      "purchase.invoice.manage",
      "purchase.landed_cost.manage",
      "purchase.return.manage",
      "inventory.view",
      "inventory.view_cost",
      "inventory.map",
      "labels.print",
      "reports.view",
      "reports.margin.view",
      "reports.pivot.share",
      "reports.export",
    ],
  },
  {
    code: "sales_manager",
    name: "Sales Manager",
    grants: [
      "settings.view",
      ...MASTERS_VIEW,
      "customers.manage",
      "customers.rates.manage",
      "rates.bulk_revise",
      "commission.manage",
      "salesmen.manage",
      "pricing.override.approve",
      "inventory.view",
      "sales.view",
      "sales.order.manage",
      "sales.credit.release",
      "sales.dispatch.manage",
      "sales.invoice.manage",
      "sales.return.manage",
      "sales.note.manage",
      "collections.view",
      "commission.view",
      "reports.view",
      "reports.margin.view",
      "reports.pivot.share",
      "reports.export",
    ],
  },
  {
    code: "sales_executive",
    name: "Sales Executive",
    grants: [
      "settings.view",
      "catalogue.view",
      "customers.view",
      "customers.manage",
      "salesmen.view",
      "transporters.view",
      "inventory.view",
      "sales.view",
      "sales.order.manage",
      "reports.view",
    ],
  },
  {
    code: "warehouse",
    name: "Warehouse",
    grants: [
      "catalogue.view",
      "transporters.view",
      "purchase.view",
      "purchase.receipt.manage",
      "inventory.view",
      "inventory.map",
      "inventory.roll.cut",
      "labels.print",
      "sales.view",
      "sales.dispatch.manage",
      "sales.return.manage",
      "reports.view",
    ],
  },
  {
    code: "accountant",
    name: "Accountant",
    grants: [
      "settings.view",
      "settings.series.view",
      "audit.view",
      ...MASTERS_VIEW,
      "purchase.view",
      "purchase.invoice.manage",
      "purchase.landed_cost.manage",
      "purchase.return.manage",
      "inventory.view",
      "inventory.view_cost",
      "sales.view",
      "sales.invoice.manage",
      "sales.invoice.cancel",
      "sales.note.manage",
      "collections.view",
      "collections.receipt.manage",
      "collections.receipt.reverse",
      "payables.view",
      "payables.payment.manage",
      "commission.view",
      "commission.payout.manage",
      "compliance.einvoice.manage",
      "reports.view",
      "reports.margin.view",
      "reports.pivot.share",
      "reports.export",
    ],
  },
] as const;

export type RoleCode = (typeof SYSTEM_ROLES)[number]["code"];

/** Expand wildcard grants into concrete permission codes. */
export function expandGrants(grants: readonly string[]): PermissionCode[] {
  const out = new Set<PermissionCode>();
  for (const grant of grants) {
    if (grant === "*") return [...PERMISSION_CODES];
    if (grant.endsWith(".*")) {
      const prefix = grant.slice(0, -1);
      const matched = PERMISSION_CODES.filter((c) => c.startsWith(prefix));
      if (matched.length === 0) throw new Error(`Unknown permission grant "${grant}"`);
      matched.forEach((c) => out.add(c));
    } else if (grant in PERMISSIONS) {
      out.add(grant as PermissionCode);
    } else {
      throw new Error(`Unknown permission grant "${grant}"`);
    }
  }
  return [...out];
}
