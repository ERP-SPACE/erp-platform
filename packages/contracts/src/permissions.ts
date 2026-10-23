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
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

/** Actions that need a fresh login within STEP_UP_SECONDS (ADR-0021). */
export const STEP_UP_PERMISSIONS: readonly PermissionCode[] = [
  "settings.series.update",
  "users.manage",
  "roles.manage",
];

export const SYSTEM_ROLES = [
  { code: "owner", name: "Owner", grants: ["*"] },
  {
    code: "admin",
    name: "Admin",
    grants: ["settings.*", "users.view", "users.manage", "audit.view"],
  },
  { code: "purchase_manager", name: "Purchase Manager", grants: ["settings.view"] },
  { code: "sales_manager", name: "Sales Manager", grants: ["settings.view"] },
  { code: "sales_executive", name: "Sales Executive", grants: ["settings.view"] },
  { code: "warehouse", name: "Warehouse", grants: [] },
  { code: "accountant", name: "Accountant", grants: ["settings.view", "settings.series.view", "audit.view"] },
] as const;

export type RoleCode = (typeof SYSTEM_ROLES)[number]["code"];

/** Expand wildcard grants into concrete permission codes. */
export function expandGrants(grants: readonly string[]): PermissionCode[] {
  const out = new Set<PermissionCode>();
  for (const grant of grants) {
    if (grant === "*") return [...PERMISSION_CODES];
    if (grant.endsWith(".*")) {
      const prefix = grant.slice(0, -1);
      PERMISSION_CODES.filter((c) => c.startsWith(prefix)).forEach((c) => out.add(c));
    } else if (grant in PERMISSIONS) {
      out.add(grant as PermissionCode);
    } else {
      throw new Error(`Unknown permission grant "${grant}"`);
    }
  }
  return [...out];
}
