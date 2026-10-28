import {
  type PostalAddress,
  type Tx,
  categories,
  companies,
  creditPolicies,
  customerShippingAddresses,
  customers,
  products,
  qualities,
  skus,
} from "@erp/db";
import {
  D,
  type GstRegime,
  type SalesInvoiceResult,
  type SalesLineInput,
  gstRegime,
  salesInvoice,
} from "@erp/domain";
import { and, eq, inArray } from "drizzle-orm";
import { actor } from "../../common/context.js";
import { trimDecimal } from "../../common/decimal.js";
import { notFound, validationError } from "../../common/errors.js";
import type { UnitOfWork } from "../../db/unit-of-work.js";
import { customerScopeFilter, loadCustomerScope } from "../customers/customer-scope.js";

export type Db = UnitOfWork["db"] | Tx;
export type SupplyType = "B2B" | "B2C" | "SEZWP" | "SEZWOP";

export const formatAddress = (a: PostalAddress) =>
  [a.line1, a.line2, `${a.city} ${a.pincode}`, a.state].filter(Boolean).join(", ");

/**
 * The customer as a sales document needs them, checked against the actor's customer scope
 * (CLAUDE.md rule 10): GST regime from the place of supply (shipping address state, else the
 * billing state — PRD §8.6), supply type for the e-invoice, and the credit policy.
 */
export async function customerContext(
  db: Db,
  customerId: string,
  shippingAddressId?: string | null,
) {
  const scope = await loadCustomerScope(db);
  const [row] = await db
    .select({ customer: customers, policy: creditPolicies, companyState: companies.stateCode })
    .from(customers)
    .innerJoin(companies, eq(companies.id, customers.companyId))
    .leftJoin(creditPolicies, eq(creditPolicies.customerId, customers.id))
    .where(and(eq(customers.id, customerId), customerScopeFilter(scope)));
  if (!row) throw notFound("Customer");
  const c = row.customer;
  let shipping: { address: PostalAddress; stateCode: string; id: string | null } = {
    address: c.billingAddress,
    stateCode: c.stateCode,
    id: null,
  };
  const [ship] = await db
    .select()
    .from(customerShippingAddresses)
    .where(
      and(
        eq(customerShippingAddresses.customerId, customerId),
        shippingAddressId
          ? eq(customerShippingAddresses.id, shippingAddressId)
          : eq(customerShippingAddresses.isDefault, true),
      ),
    );
  if (shippingAddressId && !ship) {
    throw validationError("That shipping address isn't the customer's.", [
      { path: "shippingAddressId", message: "Choose one of the customer's addresses" },
    ]);
  }
  if (ship) shipping = { address: ship.address, stateCode: ship.stateCode, id: ship.id };
  const placeOfSupply = shipping.stateCode;
  // SEZ supplies are inter-state by law (IGST Act s.7(5)); built as zero-rated under LUT
  // (ADR-0009 default) until a per-customer "with payment" option is needed.
  const regime: GstRegime =
    c.gstType === "SEZ" ? "IGST" : gstRegime(row.companyState, placeOfSupply);
  const supplyType: SupplyType =
    c.gstType === "SEZ" ? "SEZWOP" : c.gstType === "Unregistered" || !c.gstin ? "B2C" : "B2B";
  return {
    customer: c,
    policy: row.policy,
    regime,
    supplyType,
    placeOfSupply,
    shippingAddressId: shipping.id,
    billingAddress: formatAddress(c.billingAddress),
    shippingAddress: formatAddress(shipping.address),
    customerName: c.legalName,
  };
}

export function assertActiveCustomer(c: { active: boolean; legalName: string }) {
  if (!c.active) {
    throw validationError(`${c.legalName} is inactive.`, [
      { path: "customerId", message: "Choose an active customer" },
    ]);
  }
}

export interface SkuInfo {
  skuId: string;
  skuCode: string;
  productId: string;
  description: string;
  gsm: number;
  widthIn: string;
  defaultLengthM: number;
  hsnCode: string | null;
  gstRate: string | null;
  categoryName: string;
}

/** SKUs with the product, quality and category HSN / GST a sales line needs. */
export async function loadSkus(db: Db, skuIds: readonly string[]): Promise<Map<string, SkuInfo>> {
  const ids = [...new Set(skuIds)];
  if (!ids.length) return new Map();
  const rows = await db
    .select({ sku: skus, product: products, quality: qualities, category: categories })
    .from(skus)
    .innerJoin(products, eq(products.id, skus.productId))
    .innerJoin(qualities, eq(qualities.id, products.qualityId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(skus.companyId, actor().companyId), inArray(skus.id, ids)));
  if (rows.length !== ids.length) throw notFound("Product (SKU)");
  return new Map(
    rows.map(({ sku, product, quality, category }) => {
      const width = trimDecimal(sku.widthIn);
      return [
        sku.id,
        {
          skuId: sku.id,
          skuCode: sku.code,
          productId: product.id,
          description: `${category.name} ${quality.name} ${product.gsm} GSM ${width}″`,
          gsm: product.gsm,
          widthIn: width,
          defaultLengthM: product.defaultLengthM,
          hsnCode: category.hsnCode,
          gstRate: category.gstRate === null ? null : trimDecimal(category.gstRate),
          categoryName: category.name,
        },
      ];
    }),
  );
}

/** Lines whose category has no HSN / GST yet can't be invoiced (Q9). */
export function taxIssues(
  lines: readonly { description: string; hsnCode: string | null; gstRate: string | null }[],
) {
  return lines
    .filter((l) => !l.hsnCode || l.gstRate === null)
    .map((l) => `${l.description}: set the category's HSN code and GST rate in Catalogue first`);
}

export interface DocCharge {
  code: string;
  label: string;
  amount: string;
}

/** Validates extra charges against the `invoice.extraCharges` setting (Q21). */
export function resolveCharges(
  input: readonly { code: string; amount: string }[] | undefined,
  configured: readonly { code: string; label: string; active: boolean }[],
): DocCharge[] {
  return (input ?? [])
    .filter((c) => D(c.amount).greaterThan(0))
    .map((c, i) => {
      const def = configured.find((x) => x.code === c.code && x.active);
      if (!def) {
        throw validationError(`Unknown charge ${c.code}.`, [
          { path: `charges.${i}.code`, message: "Choose a charge from Settings → Invoicing" },
        ]);
      }
      return { code: c.code, label: def.label, amount: D(c.amount).toFixed(2) };
    });
}

/**
 * Totals for an SO / proforma / SI: goods lines, then charges, with the bill discount spread by
 * value (domain `salesInvoice`). Lines without a GST rate yet are priced at 0 % for display.
 */
export function documentTotals(
  goods: readonly {
    metres: number;
    ratePerM: string;
    discountPct: string;
    gstRate: string | null;
  }[],
  charges: readonly DocCharge[],
  options: { regime: GstRegime; billDiscount: string; zeroRated: boolean; roundOffTo: number },
): SalesInvoiceResult | null {
  if (!goods.length) return null;
  const inputs: SalesLineInput[] = [
    ...goods.map((g) => ({
      kind: "GOODS" as const,
      metres: g.metres,
      ratePerM: g.ratePerM,
      discountPct: g.discountPct,
      gstRate: g.gstRate ?? 0,
    })),
    ...charges.map((c) => ({ kind: "CHARGE" as const, amount: c.amount })),
  ];
  return salesInvoice(inputs, {
    regime: options.regime,
    billDiscount: options.billDiscount,
    zeroRated: options.zeroRated,
    roundOffTo: options.roundOffTo,
  });
}

/** The money columns a document stores from its totals. */
export function totalsColumns(r: SalesInvoiceResult | null) {
  const z = "0.00";
  if (!r) {
    return { gross: z, discount: z, taxable: z, cgst: z, sgst: z, igst: z, roundOff: z, total: z };
  }
  const t = r.totals;
  return {
    gross: r.lines.reduce((s, l) => s.plus(l.gross), D(0)).toFixed(2),
    discount: r.discountTotal.toFixed(2),
    taxable: t.taxable.toFixed(2),
    cgst: t.cgst.toFixed(2),
    sgst: t.sgst.toFixed(2),
    igst: t.igst.toFixed(2),
    roundOff: t.roundOff.toFixed(2),
    total: t.total.toFixed(2),
  };
}

/** Contract `salesTotals` from stored columns. */
export function totalsOut(
  row: {
    gross: string;
    discount: string;
    taxable: string;
    cgst: string;
    sgst: string;
    igst: string;
    roundOff: string;
    total: string;
  },
  regime: GstRegime,
) {
  const f = (v: string) => D(v).toFixed(2);
  return {
    gross: f(row.gross),
    discount: f(row.discount),
    taxable: f(row.taxable),
    cgst: f(row.cgst),
    sgst: f(row.sgst),
    igst: f(row.igst),
    roundOff: f(row.roundOff),
    total: f(row.total),
    regime,
  };
}

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
