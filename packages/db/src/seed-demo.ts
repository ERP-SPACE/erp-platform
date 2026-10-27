import { gstinCheckChar } from "@erp/domain";
import { hashPassword } from "better-auth/crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Db } from "./client.js";
import {
  account,
  roles,
  user,
  userRoles,
  categories,
  commissionRules,
  companies,
  creditPolicies,
  customerContacts,
  customerGroupMembers,
  customerGroups,
  customers,
  masterSequences,
  partyRates,
  products,
  qualities,
  rateHistory,
  salesmanDefaultRates,
  salesmen,
  skus,
  suppliers,
  transporters,
} from "./schema/index.js";
import type { PostalAddress } from "./schema/tenancy.js";

/**
 * Development-only sign-in for trying the masters screens without the Owner's authenticator:
 * Admin + Sales Manager roles (no TOTP requirement). Created once; the password comes from
 * DEMO_USER_PASSWORD in the gitignored .env.
 */
export async function seedDemoUser(
  db: Db,
  options: { email: string; password: string },
): Promise<{ created: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.reason', 'Demo user', true)`);
    const email = options.email.toLowerCase();
    const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (existing) return { created: false };
    const company = (await tx.select().from(companies).where(eq(companies.code, "MAIN")))[0];
    if (!company) throw new Error("Run the base seed (pnpm db:reset) first.");
    const userId = uuidv7();
    await tx.insert(user).values({
      id: userId,
      name: "Demo Manager",
      email,
      emailVerified: true,
      companyId: company.id,
    });
    await tx.insert(account).values({
      id: uuidv7(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: await hashPassword(options.password),
    });
    const roleRows = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.companyId, company.id), inArray(roles.code, ["admin", "sales_manager"])));
    await tx.insert(userRoles).values(roleRows.map((r) => ({ userId, roleId: r.id })));
    return { created: true };
  });
}

/**
 * Development-only demo data so the Stage 1 screens are not empty: a product × width grid,
 * 8 suppliers, 3 transporters, 5 salesmen with defaults, 40 customers with credit policies,
 * contacts, groups and party rates. Refuses to run twice (checks for existing customers).
 * Names and GSTINs are invented; GSTINs carry a valid check character.
 */
export async function seedDemo(db: Db): Promise<{ skipped: boolean; customers: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.reason', 'Demo seed', true)`);
    const company = (await tx.select().from(companies).where(eq(companies.code, "MAIN")))[0];
    if (!company) throw new Error("Run the base seed (pnpm db:reset) first.");
    const existing = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(customers)
      .where(eq(customers.companyId, company.id));
    if ((existing[0]?.n ?? 0) > 0) return { skipped: true, customers: existing[0]!.n };

    const rand = mulberry32(20261023);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;

    async function nextCode(entity: string): Promise<string> {
      const [row] = await tx
        .update(masterSequences)
        .set({ nextValue: sql`${masterSequences.nextValue} + 1` })
        .where(and(eq(masterSequences.companyId, company!.id), eq(masterSequences.entity, entity)))
        .returning();
      const value = row!.nextValue - 1;
      return `${row!.prefix}${String(value).padStart(row!.padding, "0")}`;
    }

    // ── catalogue ──────────────────────────────────────────────────────────
    const cats = new Map(
      (await tx.select().from(categories).where(eq(categories.companyId, company.id))).map((c) => [
        c.code,
        c,
      ]),
    );
    const quals = new Map(
      (await tx.select().from(qualities).where(eq(qualities.companyId, company.id))).map((q) => [
        q.name,
        q,
      ]),
    );
    const grid = [
      { cat: "SUB", quality: "Premium", gsms: [30, 35, 45, 55, 65, 80, 100], base: 14 },
      { cat: "SUB", quality: "Standard", gsms: [30, 35, 45, 55, 65, 80], base: 12 },
      { cat: "SUB", quality: "Economy", gsms: [30, 35, 45, 55], base: 10 },
      { cat: "BTR", quality: "Standard", gsms: [45, 55, 65], base: 9 },
    ];
    const widths = ["24", "36", "44", "63"];
    const productRates: { productId: string; rate: number }[] = [];
    for (const row of grid) {
      const category = cats.get(row.cat)!;
      const quality = quals.get(row.quality)!;
      for (const gsm of row.gsms) {
        const [product] = await tx
          .insert(products)
          .values({
            companyId: company.id,
            categoryId: category.id,
            qualityId: quality.id,
            gsm,
            defaultLengthM: pick([1000, 1000, 1500, 2000]),
          })
          .returning();
        productRates.push({ productId: product!.id, rate: row.base + gsm * 0.12 });
        await tx.insert(skus).values(
          widths.map((w) => ({
            companyId: company.id,
            productId: product!.id,
            code: `${row.cat}-${row.quality.slice(0, 3).toUpperCase()}-${String(gsm).padStart(3, "0")}-${w}`,
            widthIn: w,
          })),
        );
      }
    }

    // ── suppliers & transporters ──────────────────────────────────────────
    const supplierNames = [
      ["Shree Ambika Paper Mills", "SAP", "24"],
      ["Coating Tech Industries", "CTI", "27"],
      ["Jinhua Sublimation Co. (India)", "JSC", "24"],
      ["Vapi Specialty Papers", "VSP", "24"],
      ["Rajasthan Kraft & Coated", "RKC", "08"],
      ["Delhi Digital Media", "DDM", "07"],
      ["Chennai Transfer Papers", "CTP", "33"],
      ["Om Sai Paper Traders", "OSP", "24"],
    ] as const;
    for (const [name, shortCode, state] of supplierNames) {
      await tx.insert(suppliers).values({
        companyId: company.id,
        code: await nextCode("supplier"),
        shortCode,
        name,
        gstin: gstin(state, rand, "C"),
        stateCode: state,
        address: address(state, rand),
        contactName: pick(FIRST) + " " + pick(LAST),
        contactPhone: phone(rand),
        paymentDays: pick([15, 30, 45, 60]),
      });
    }
    for (const [name, state] of [
      ["VRL Logistics", "29"],
      ["Shree Maruti Courier", "24"],
      ["Patel Roadways", "24"],
    ] as const) {
      await tx.insert(transporters).values({
        companyId: company.id,
        code: await nextCode("transporter"),
        name,
        gstin: gstin(state, rand, "C"),
        stateCode: state,
        phone: phone(rand),
      });
    }

    // ── salesmen ──────────────────────────────────────────────────────────
    const salesmanIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const [s] = await tx
        .insert(salesmen)
        .values({
          companyId: company.id,
          code: await nextCode("salesman"),
          name: `${pick(FIRST)} ${pick(LAST)}`,
          phone: phone(rand),
          whatsapp: phone(rand),
          stateCode: "24",
          address: address("24", rand),
          targetSalesM: pick([50000, 75000, 100000]),
          defaultCreditLimit: pick(["150000", "200000", "300000"]),
          defaultCreditDays: pick([30, 45]),
          defaultGraceDays: pick([7, 10, 15]),
        })
        .returning();
      salesmanIds.push(s!.id);
      // Default rates: a slight discount on a few products.
      for (const pr of productRates.filter((_, idx) => idx % 3 === i % 3)) {
        await tx.insert(salesmanDefaultRates).values({
          salesmanId: s!.id,
          productId: pr.productId,
          baseRate44: (pr.rate * 0.97).toFixed(2),
        });
      }
    }

    // ── customers ────────────────────────────────────────────────────────
    const groups = await tx
      .select()
      .from(customerGroups)
      .where(eq(customerGroups.companyId, company.id));
    const today = new Date().toISOString().slice(0, 10);
    const fyStart = `${Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0)}-04-01`;
    for (let i = 0; i < 40; i++) {
      const state = pick(["24", "24", "24", "24", "27", "08", "07", "33"]);
      const unregistered = i % 9 === 4;
      const trade = `${pick(PREFIX)} ${pick(SUFFIX)}`;
      const salesmanId = i % 4 === 3 ? null : pick(salesmanIds);
      const [c] = await tx
        .insert(customers)
        .values({
          companyId: company.id,
          code: await nextCode("customer"),
          legalName: `${trade} ${pick(["Pvt Ltd", "LLP", "", "Enterprises"])}`.trim(),
          tradeName: trade,
          gstType: unregistered ? "Unregistered" : i % 13 === 6 ? "Composition" : "Regular",
          gstin: unregistered ? null : gstin(state, rand, pick(["C", "P", "F"])),
          stateCode: state,
          billingAddress: address(state, rand),
          phone: phone(rand),
          email: `accounts${i + 1}@example.in`,
          businessType: pick(["Textile printer", "Garment exporter", "Print shop", "Distributor"]),
          monthlyCapacityM: pick([5000, 10000, 25000, 50000]),
          targetSalesM: pick([3000, 8000, 20000]),
          whatsappNumber: phone(rand),
          whatsappLanguage: pick(["English", "Hindi", "Gujarati"] as const),
          allowCut: rand() > 0.2,
          salesmanId,
        })
        .returning();
      const customerId = c!.id;
      await tx.insert(creditPolicies).values({
        customerId,
        creditLimit: pick(["50000", "100000", "100000", "250000", "500000"]),
        creditDays: pick([15, 30, 30, 45]),
        graceDays: pick([7, 15]),
        blockRule: "BOTH",
        manualBlock: i % 11 === 7,
        blockReason: i % 11 === 7 ? "Cheque returned — on hold until cleared" : null,
        blockedAt: i % 11 === 7 ? new Date() : null,
      });
      await tx.insert(customerContacts).values([
        {
          customerId,
          name: `${pick(FIRST)} ${pick(LAST)}`,
          phone: phone(rand),
          role: "Owner",
          isPrimary: true,
        },
        { customerId, name: `${pick(FIRST)} ${pick(LAST)}`, phone: phone(rand), role: "Accounts" },
      ]);
      if (rand() > 0.3) {
        await tx.insert(customerGroupMembers).values({ customerId, groupId: pick(groups).id });
      }
      // Rates for a handful of products, effective from the FY start.
      const chosen = productRates.filter(() => rand() > 0.75).slice(0, 6);
      for (const pr of chosen) {
        const rate = (pr.rate * (0.95 + rand() * 0.1)).toFixed(2);
        await tx.insert(partyRates).values({
          customerId,
          productId: pr.productId,
          baseRate44: rate,
          validFrom: fyStart,
          source: "manual",
        });
        await tx.insert(rateHistory).values({
          customerId,
          productId: pr.productId,
          newRate44: rate,
          validFrom: fyStart,
          source: "manual",
          reason: "Opening rate (demo)",
        });
      }
      if (salesmanId && rand() > 0.5) {
        const perMetre = rand() > 0.5;
        await tx.insert(commissionRules).values({
          salesmanId,
          customerId,
          method: perMetre ? "PER_METER" : "PERCENT_SALES",
          rate: perMetre ? "0.25" : "1.5",
          triggerEvent: pick(["ON_SI_POSTED", "ON_PAYMENT_RECEIVED"] as const),
          validFrom: fyStart,
        });
      }
    }
    return { skipped: false, customers: 40 };
  });
}

const FIRST = [
  "Rakesh",
  "Priya",
  "Hitesh",
  "Neha",
  "Vipul",
  "Kiran",
  "Manish",
  "Dipti",
  "Arjun",
  "Sonal",
];
const LAST = [
  "Patel",
  "Shah",
  "Desai",
  "Mehta",
  "Joshi",
  "Modi",
  "Agarwal",
  "Iyer",
  "Gupta",
  "Kapadia",
];
const PREFIX = [
  "Shiv",
  "Laxmi",
  "Krishna",
  "Riddhi",
  "Siddhi",
  "Om",
  "Jay",
  "Navkar",
  "Param",
  "Sai",
  "Ganesh",
  "Vraj",
];
const SUFFIX = [
  "Prints",
  "Digital",
  "Fab Print",
  "Textiles",
  "Graphics",
  "Sublimation",
  "Creations",
  "Impex",
];
const CITIES: Record<string, [string, string, string]> = {
  "24": ["Surat", "Gujarat", "3950"],
  "27": ["Bhiwandi", "Maharashtra", "4213"],
  "08": ["Jaipur", "Rajasthan", "3020"],
  "07": ["New Delhi", "Delhi", "1100"],
  "33": ["Tiruppur", "Tamil Nadu", "6416"],
  "29": ["Bengaluru", "Karnataka", "5600"],
};

function address(state: string, rand: () => number): PostalAddress {
  const [city, stateName, pin] = CITIES[state] ?? CITIES["24"]!;
  return {
    line1: `${Math.floor(rand() * 300) + 1}, ${["Ring Road", "GIDC Estate", "Textile Market", "Industrial Area"][Math.floor(rand() * 4)]}`,
    city,
    state: stateName,
    pincode: `${pin}${String(Math.floor(rand() * 100)).padStart(2, "0")}`,
  };
}

function phone(rand: () => number): string {
  return `9${String(Math.floor(rand() * 1e9)).padStart(9, "0")}`;
}

function gstin(state: string, rand: () => number, holder: string): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const L = () => letters[Math.floor(rand() * 26)]!;
  const pan = `${L()}${L()}${L()}${holder}${L()}${String(Math.floor(rand() * 10000)).padStart(4, "0")}${L()}`;
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
}

/** Small deterministic PRNG so the demo data is the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
