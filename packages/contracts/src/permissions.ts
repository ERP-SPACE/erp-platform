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
    ],
  },
  {
    code: "purchase_manager",
    name: "Purchase Manager",
    grants: ["settings.view", "catalogue.view", "suppliers.*", "transporters.*"],
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
    ],
  },
  { code: "warehouse", name: "Warehouse", grants: ["catalogue.view", "transporters.view"] },
  {
    code: "accountant",
    name: "Accountant",
    grants: ["settings.view", "settings.series.view", "audit.view", ...MASTERS_VIEW],
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
