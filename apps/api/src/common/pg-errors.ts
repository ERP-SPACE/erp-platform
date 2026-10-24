import type { Problem } from "@erp/contracts";
import { AppError } from "./errors.js";

interface PgError {
  code: string;
  constraint?: string;
  detail?: string;
}

/** Friendly messages for the constraints users can actually hit (field path → message). */
const CONSTRAINTS: Record<string, { path: string; message: string }> = {
  categories_company_code_uq: { path: "code", message: "A category with this code already exists." },
  qualities_company_name_uq: { path: "name", message: "A quality with this name already exists." },
  products_unique_triple_uq: {
    path: "gsm",
    message: "This category already has a product with this quality and GSM.",
  },
  skus_product_width_uq: { path: "widthsIn", message: "This product already has a SKU at that width." },
  skus_company_code_uq: { path: "code", message: "A SKU with this code already exists." },
  suppliers_company_short_code_uq: {
    path: "shortCode",
    message: "Another supplier already uses this barcode short code.",
  },
  suppliers_company_gstin_uq: { path: "gstin", message: "Another supplier has this GSTIN." },
  customers_company_gstin_uq: { path: "gstin", message: "Another customer has this GSTIN." },
  customer_contacts_one_primary_uq: { path: "contacts", message: "Only one contact can be primary." },
  customer_shipping_one_default_uq: {
    path: "shippingAddresses",
    message: "Only one shipping address can be the default.",
  },
  party_rates_no_overlap: {
    path: "validFrom",
    message: "This rate overlaps an existing rate for the same product.",
  },
  commission_rules_no_overlap: {
    path: "validFrom",
    message: "This rule overlaps an existing commission rule for the same customer.",
  },
};

/** Drizzle wraps driver errors; walk the cause chain to find the Postgres one. */
function findPgError(e: unknown): PgError | undefined {
  for (let cur = e, depth = 0; cur && depth < 5; depth++) {
    const candidate = cur as Partial<PgError> & { cause?: unknown };
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return candidate as PgError;
    }
    cur = candidate.cause;
  }
  return undefined;
}

/**
 * Turns unique (23505) and exclusion (23P01) violations into 409 problems with a field issue,
 * so the database stays the source of truth (e.g. the Stage 1 overlapping-rate gate) and the
 * user still gets a readable message. Returns undefined for anything else.
 */
export function fromPgError(e: unknown): AppError | undefined {
  const pg = findPgError(e);
  if (!pg || (pg.code !== "23505" && pg.code !== "23P01")) return undefined;
  const known = pg.constraint ? CONSTRAINTS[pg.constraint] : undefined;
  const issues: Problem["issues"] = known ? [known] : undefined;
  if (pg.code === "23P01") {
    return new AppError(
      409,
      "OVERLAP",
      known?.message ?? "This overlaps an existing record.",
      issues ? { issues } : {},
    );
  }
  return new AppError(
    409,
    "DUPLICATE",
    known?.message ?? "A record with these details already exists.",
    issues ? { issues } : {},
  );
}
