import { z } from "zod";

/**
 * Stage 1 master-data contracts: catalogue, suppliers, transporters, customers, rates, salesmen.
 * Money and rates travel as decimal strings (ADR-0002); dates as YYYY-MM-DD (IST calendar dates).
 */

// ── shared ────────────────────────────────────────────────────────────────────

export const money = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 100000 or 1250.50");
export const rate4 = z.string().regex(/^\d{1,8}(\.\d{1,4})?$/, "Enter a rate like 6.25");
export const isoDate = z.iso.date();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
    "GSTIN must be 15 characters, e.g. 24ABCDE1234F1Z5",
  );
const pan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}\d{4}[A-Z]$/, "PAN must look like ABCDE1234F");
const phone = z
  .string()
  .trim()
  .regex(/^[+0-9 ()-]{6,20}$/, "Enter a valid phone number");
const stateCode = z.string().regex(/^\d{2}$/, "Choose a GST state");

export const address = z.object({
  line1: z.string().trim().min(1, "Required").max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(1, "Required").max(60),
  state: z.string().trim().min(1, "Required").max(60),
  pincode: z.string().regex(/^\d{6}$/, "PIN code must be 6 digits"),
});
export type Address = z.infer<typeof address>;

export const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  active: z.enum(["true", "false", "all"]).default("true"),
});

export const versioned = z.object({ version: z.number().int().positive() });

// ── catalogue ─────────────────────────────────────────────────────────────────

export const categoryItem = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  hsnCode: z.string().nullable(),
  gstRate: z.string().nullable(),
  /** HSN and GST rate both set — required before the category can be invoiced (Q9). */
  taxReady: z.boolean(),
  active: z.boolean(),
  version: z.number().int(),
  productCount: z.number().int(),
  skuCount: z.number().int(),
});
export const categoryUpdate = z.object({
  name: z.string().trim().min(2).max(60),
  hsnCode: z
    .string()
    .trim()
    .regex(/^\d{4}(\d{2}){0,2}$/, "HSN is 4, 6 or 8 digits")
    .nullable(),
  gstRate: z.enum(["0", "5", "12", "18", "28"]).nullable(),
  active: z.boolean(),
  version: z.number().int().positive(),
});

export const categoryCreate = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,6}$/, "2–6 letters or digits, e.g. SUB"),
  name: z.string().trim().min(2).max(60),
});

export const qualityItem = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  active: z.boolean(),
  version: z.number().int(),
});
export const qualityInput = z.object({
  name: z.string().trim().min(2).max(40),
  aliases: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});

export const qualityUpdate = qualityInput.extend({
  active: z.boolean(),
  version: z.number().int().positive(),
});

export const skuItem = z.object({
  id: z.string(),
  productId: z.string(),
  code: z.string(),
  widthIn: z.string(),
  taxRateOverride: z.string().nullable(),
  active: z.boolean(),
  version: z.number().int(),
});

export const productItem = z.object({
  id: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  qualityId: z.string(),
  qualityName: z.string(),
  gsm: z.number().int(),
  name: z.string(),
  defaultLengthM: z.number().int(),
  active: z.boolean(),
  version: z.number().int(),
  skus: z.array(skuItem),
});
export const productCreate = z.object({
  categoryId: z.string(),
  qualityId: z.string(),
  gsm: z.number().int().positive(),
  defaultLengthM: z.number().int().positive(),
  widthsIn: z.array(z.number().positive()).default([]),
});
export const productUpdate = z.object({
  defaultLengthM: z.number().int().positive(),
  active: z.boolean(),
  version: z.number().int().positive(),
});
export const skuBulkAdd = z.object({ widthsIn: z.array(z.number().positive()).min(1) });
export const skuUpdate = z.object({
  taxRateOverride: z.enum(["0", "5", "12", "18", "28"]).nullable(),
  active: z.boolean(),
  version: z.number().int().positive(),
});

// ── suppliers & transporters ──────────────────────────────────────────────────

export const supplierInput = z.object({
  name: z.string().trim().min(2).max(120),
  shortCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3}$/, "3 letters or digits — printed on roll barcodes")
    .optional(),
  gstin: gstin.nullable().optional(),
  stateCode,
  pan: pan.nullable().optional(),
  address,
  contactName: optionalText(80),
  contactPhone: phone.nullable().optional(),
  contactEmail: z.email().nullable().optional(),
  paymentDays: z.number().int().min(0).max(365).default(30),
  notes: optionalText(500),
});
export const supplierUpdate = supplierInput.extend({
  active: z.boolean(),
  version: z.number().int().positive(),
});
export const supplierItem = z.object({
  id: z.string(),
  code: z.string(),
  shortCode: z.string(),
  name: z.string(),
  gstin: z.string().nullable(),
  stateCode: z.string(),
  pan: z.string().nullable(),
  address,
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  paymentDays: z.number().int(),
  notes: z.string().nullable(),
  active: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
});

export const transporterInput = z.object({
  name: z.string().trim().min(2).max(120),
  gstin: gstin.nullable().optional(),
  /** 15-character transporter ID for unregistered transporters (e-way bills). */
  transporterId: z.string().trim().toUpperCase().max(15).nullable().optional(),
  stateCode,
  phone: phone.nullable().optional(),
  contactName: optionalText(80),
});
export const transporterUpdate = transporterInput.extend({
  active: z.boolean(),
  version: z.number().int().positive(),
});
export const transporterItem = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  gstin: z.string().nullable(),
  transporterId: z.string().nullable(),
  stateCode: z.string(),
  phone: z.string().nullable(),
  contactName: z.string().nullable(),
  active: z.boolean(),
  version: z.number().int(),
});

// ── customers ─────────────────────────────────────────────────────────────────

export const GST_TYPES = ["Regular", "Composition", "Unregistered", "SEZ"] as const;
export const BLOCK_RULES = ["OVER_LIMIT", "OVER_DUE", "BOTH"] as const;
export const WHATSAPP_LANGUAGES = ["English", "Hindi", "Gujarati"] as const;

export const customerGroupItem = z.object({ id: z.string(), code: z.string(), name: z.string() });

export const contactInput = z.object({
  name: z.string().trim().min(1, "Required").max(80),
  phone: phone.nullable().optional(),
  email: z.email().nullable().optional(),
  role: optionalText(40),
  isPrimary: z.boolean().default(false),
});
export const shippingAddressInput = z.object({
  label: z.string().trim().min(1).max(40),
  address,
  stateCode,
  isDefault: z.boolean().default(false),
});
export const creditPolicyInput = z.object({
  creditLimit: money,
  creditDays: z.number().int().min(0).max(365),
  graceDays: z.number().int().min(0).max(180),
  autoBlock: z.boolean(),
  blockRule: z.enum(BLOCK_RULES),
});

const customerBase = z.object({
  legalName: z.string().trim().min(2, "Enter the customer's name").max(160),
  tradeName: optionalText(160),
  gstType: z.enum(GST_TYPES),
  gstin: gstin.nullable().optional(),
  stateCode,
  pan: pan.nullable().optional(),
  billingAddress: address,
  phone: phone.nullable().optional(),
  email: z.email().nullable().optional(),
  businessType: optionalText(60),
  monthlyCapacityM: z.number().int().min(0).nullable().optional(),
  targetSalesM: z.number().int().min(0).nullable().optional(),
  referral: z
    .object({
      source: optionalText(60),
      name: optionalText(80),
      contact: optionalText(40),
      company: optionalText(120),
      remarks: optionalText(300),
    })
    .nullable()
    .optional(),
  tcsApplicable: z.boolean().default(false),
  whatsappNumber: phone.nullable().optional(),
  whatsappLanguage: z.enum(WHATSAPP_LANGUAGES).default("English"),
  whatsappConsent: z.boolean().default(false),
  allowCut: z.boolean().default(true),
  salesmanId: z.string().nullable().optional(),
  accountManagerUserId: z.string().nullable().optional(),
  groupIds: z.array(z.string()).default([]),
  contacts: z.array(contactInput).max(20).default([]),
  shippingAddresses: z.array(shippingAddressInput).max(20).default([]),
});

export const customerCreate = customerBase.extend({
  /** Omitted → salesman defaults, else the `credit.defaults` setting (Q7). */
  creditPolicy: creditPolicyInput.optional(),
  /** Copy the salesman's default product rates as this customer's rates from today. */
  applySalesmanRates: z.boolean().default(true),
});
export const customerUpdate = customerBase.extend({
  active: z.boolean(),
  version: z.number().int().positive(),
});
export type CustomerCreate = z.infer<typeof customerCreate>;

export const creditPolicyItem = creditPolicyInput.extend({
  manualBlock: z.boolean(),
  blockReason: z.string().nullable(),
  blockedAt: z.string().nullable(),
  blockedByName: z.string().nullable(),
  version: z.number().int(),
});

export const customerListItem = z.object({
  id: z.string(),
  code: z.string(),
  legalName: z.string(),
  tradeName: z.string().nullable(),
  gstin: z.string().nullable(),
  gstType: z.enum(GST_TYPES),
  stateCode: z.string(),
  city: z.string(),
  groups: z.array(customerGroupItem),
  salesmanId: z.string().nullable(),
  salesmanName: z.string().nullable(),
  creditLimit: z.string(),
  creditDays: z.number().int(),
  blocked: z.boolean(),
  active: z.boolean(),
  createdAt: z.string(),
});

export const contactItem = contactInput.extend({ id: z.string(), isPrimary: z.boolean() });
export const shippingAddressItem = shippingAddressInput.extend({
  id: z.string(),
  isDefault: z.boolean(),
});

export const customerDetail = customerListItem.extend({
  pan: z.string().nullable(),
  billingAddress: address,
  phone: z.string().nullable(),
  email: z.string().nullable(),
  businessType: z.string().nullable(),
  monthlyCapacityM: z.number().int().nullable(),
  targetSalesM: z.number().int().nullable(),
  referral: z
    .object({
      source: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      contact: z.string().nullable().optional(),
      company: z.string().nullable().optional(),
      remarks: z.string().nullable().optional(),
    })
    .nullable(),
  tcsApplicable: z.boolean(),
  whatsappNumber: z.string().nullable(),
  whatsappLanguage: z.enum(WHATSAPP_LANGUAGES),
  whatsappConsent: z.boolean(),
  whatsappConsentAt: z.string().nullable(),
  allowCut: z.boolean(),
  accountManagerUserId: z.string().nullable(),
  accountManagerName: z.string().nullable(),
  contacts: z.array(contactItem),
  shippingAddresses: z.array(shippingAddressItem),
  creditPolicy: creditPolicyItem,
  version: z.number().int(),
  updatedAt: z.string(),
});
export type CustomerDetail = z.infer<typeof customerDetail>;

export const customerListQuery = listQuery.extend({
  groupId: z.string().optional(),
  salesmanId: z.string().optional(),
  stateCode: z.string().optional(),
  blocked: z.enum(["true", "false"]).optional(),
});

export const blockCustomerInput = z.object({
  blocked: z.boolean(),
  version: z.number().int().positive(),
});

// ── rates ─────────────────────────────────────────────────────────────────────

export const RATE_SOURCES = ["manual", "bulk_revision", "salesman_default"] as const;

export const partyRateItem = z.object({
  id: z.string(),
  productId: z.string(),
  productName: z.string(),
  categoryName: z.string(),
  baseRate44: z.string(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  source: z.enum(RATE_SOURCES),
  current: z.boolean(),
});
export const partyRateInput = z.object({
  productId: z.string(),
  baseRate44: rate4,
  validFrom: isoDate,
  validTo: isoDate.nullable().optional(),
  /** "revise" closes the currently open rate the day before `validFrom`; "add" inserts as-is. */
  mode: z.enum(["revise", "add"]).default("revise"),
});
export const rateHistoryItem = z.object({
  id: z.string(),
  productName: z.string(),
  previousRate44: z.string().nullable(),
  newRate44: z.string(),
  validFrom: z.string(),
  source: z.enum(RATE_SOURCES),
  reason: z.string().nullable(),
  byName: z.string().nullable(),
  at: z.string(),
});

export const bulkRevisionInput = z.object({
  customerIds: z.array(z.string()).default([]),
  groupIds: z.array(z.string()).default([]),
  categoryIds: z.array(z.string()).default([]),
  qualityIds: z.array(z.string()).default([]),
  gsms: z.array(z.number().int()).default([]),
  mode: z.enum(["PERCENT", "FLAT"]),
  value: z.string().regex(/^-?\d{1,6}(\.\d{1,4})?$/, "Enter a number like 4 or -0.25"),
  effectiveFrom: isoDate,
});
export type BulkRevisionInput = z.infer<typeof bulkRevisionInput>;
export const bulkRevisionRow = z.object({
  customerId: z.string(),
  customerName: z.string(),
  productId: z.string(),
  productName: z.string(),
  oldRate44: z.string(),
  newRate44: z.string(),
});
export const bulkRevisionPreview = z.object({
  rows: z.array(bulkRevisionRow),
  customers: z.number().int(),
});
export const bulkRevisionResult = z.object({
  revised: z.number().int(),
  customers: z.number().int(),
});

// ── salesmen & commission ─────────────────────────────────────────────────────

export const BLOCK_MODES = ["None", "All", "Selective"] as const;
export const COMMISSION_METHODS = ["PER_METER", "PERCENT_SALES"] as const;
export const COMMISSION_TRIGGERS = ["ON_SI_POSTED", "ON_PAYMENT_RECEIVED"] as const;
export const KYC_DOC_TYPES = [
  "PAN",
  "Aadhaar",
  "GST certificate",
  "Bank proof",
  "Agreement",
  "Other",
] as const;

export const salesmanInput = z.object({
  name: z.string().trim().min(2).max(80),
  phone: phone.nullable().optional(),
  whatsapp: phone.nullable().optional(),
  email: z.email().nullable().optional(),
  address: address.nullable().optional(),
  stateCode: stateCode.nullable().optional(),
  targetSalesM: z.number().int().min(0).nullable().optional(),
  defaultCreditLimit: money.nullable().optional(),
  defaultCreditDays: z.number().int().min(0).max(365).nullable().optional(),
  defaultGraceDays: z.number().int().min(0).max(180).nullable().optional(),
});
export const salesmanUpdate = salesmanInput.extend({
  active: z.boolean(),
  version: z.number().int().positive(),
});
export const salesmanItem = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  email: z.string().nullable(),
  stateCode: z.string().nullable(),
  targetSalesM: z.number().int().nullable(),
  blockMode: z.enum(BLOCK_MODES),
  customerCount: z.number().int(),
  active: z.boolean(),
  version: z.number().int(),
});
export const salesmanDefaultRate = z.object({
  productId: z.string(),
  productName: z.string(),
  baseRate44: z.string(),
});
export const kycDocumentItem = z.object({
  id: z.string(),
  docType: z.enum(KYC_DOC_TYPES),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  notes: z.string().nullable(),
  uploadedAt: z.string(),
  uploadedByName: z.string().nullable(),
});
export const salesmanDetail = salesmanItem.extend({
  address: address.nullable(),
  defaultCreditLimit: z.string().nullable(),
  defaultCreditDays: z.number().int().nullable(),
  defaultGraceDays: z.number().int().nullable(),
  defaultRates: z.array(salesmanDefaultRate),
  blockedCustomerIds: z.array(z.string()),
  kycDocuments: z.array(kycDocumentItem),
});
export const salesmanDefaultRatesInput = z.object({
  rates: z.array(z.object({ productId: z.string(), baseRate44: rate4 })).max(500),
});
export const salesmanBlockInput = z.object({
  blockMode: z.enum(BLOCK_MODES),
  customerIds: z.array(z.string()).default([]),
  version: z.number().int().positive(),
});

export const commissionRuleInput = z.object({
  customerId: z.string(),
  method: z.enum(COMMISSION_METHODS),
  /** ₹ per metre (PER_METER) or percent of taxable value (PERCENT_SALES, Q11). */
  rate: rate4,
  triggerEvent: z.enum(COMMISSION_TRIGGERS),
  validFrom: isoDate,
  validTo: isoDate.nullable().optional(),
});
export const commissionRuleItem = commissionRuleInput.extend({
  id: z.string(),
  salesmanId: z.string(),
  customerName: z.string(),
  validTo: z.string().nullable(),
  current: z.boolean(),
});

// ── search & dashboard ────────────────────────────────────────────────────────

export const searchResult = z.object({
  type: z.enum(["customer", "supplier", "transporter", "salesman", "product"]),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
});
export const searchResponse = z.object({ results: z.array(searchResult) });

export const dashboardSummary = z.object({
  activeCustomers: z.number().int(),
  suppliers: z.number().int(),
  skus: z.number().int(),
  blockedCustomers: z.number().int(),
  categoriesMissingTax: z.number().int(),
  totalCreditLimit: z.string(),
});

export type CategoryItem = z.infer<typeof categoryItem>;
export type QualityItem = z.infer<typeof qualityItem>;
export type ProductItem = z.infer<typeof productItem>;
export type SkuItem = z.infer<typeof skuItem>;
export type SupplierItem = z.infer<typeof supplierItem>;
export type TransporterItem = z.infer<typeof transporterItem>;
export type CustomerGroupItem = z.infer<typeof customerGroupItem>;
export type CustomerListItem = z.infer<typeof customerListItem>;
export type PartyRateItem = z.infer<typeof partyRateItem>;
export type RateHistoryItem = z.infer<typeof rateHistoryItem>;
export type BulkRevisionRow = z.infer<typeof bulkRevisionRow>;
export type SalesmanItem = z.infer<typeof salesmanItem>;
export type SalesmanDetail = z.infer<typeof salesmanDetail>;
export type KycDocumentItem = z.infer<typeof kycDocumentItem>;
export type CommissionRuleItem = z.infer<typeof commissionRuleItem>;
export type SearchResult = z.infer<typeof searchResult>;
export type DashboardSummary = z.infer<typeof dashboardSummary>;
