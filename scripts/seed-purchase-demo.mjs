#!/usr/bin/env node
/**
 * Dev-only Stage 2 demo data, created through the running API (so every rule applies), from the
 * owner's real purchase invoices:
 *  - Shree Balajee & Co: PO → GRN (44″ and 60″ rolls) → PI 2455 (₹96,838) → freight by weight
 *  - Orange O Tec: a container lot (CONT-13) received without a PO, left Unmapped for mapping
 *  - a draft PO for Orange O Tec
 * Needs the API on :3000 and DEMO_USER_* in .env (pnpm db:seed:demo). Refuses to run twice.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));
const API = process.env.DEMO_API_URL ?? "http://localhost:3000";
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const { DEMO_USER_EMAIL: email, DEMO_USER_PASSWORD: password } = process.env;
if (!email || !password)
  throw new Error("Set DEMO_USER_EMAIL / DEMO_USER_PASSWORD in .env (see .env.example)");

let cookie = "";
async function req(method, path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      cookie,
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

await req("POST", "/api/auth/sign-in/email", { email, password });
if ((await req("GET", "/api/purchase-orders")).length) {
  console.log("Purchase demo data already present — nothing changed.");
  process.exit(0);
}

// Suppliers (from the invoices).
const suppliers = await req("GET", "/api/suppliers?active=all");
async function supplier(name, shortCode, gstin, address, paymentDays) {
  return (
    suppliers.find((s) => s.gstin === gstin) ??
    (await req("POST", "/api/suppliers", {
      name,
      shortCode,
      stateCode: "24",
      gstin,
      address,
      paymentDays,
    }))
  );
}
const sbc = await supplier(
  "Shree Balajee & Co.",
  "SBC",
  "24AAXPR0176M1ZZ",
  {
    line1: "Plot No. B/4, B/5, Laxminarayan Industrial Estate",
    line2: "Udhna Navsari Road, Bhedwad",
    city: "Surat",
    state: "Gujarat",
    pincode: "394210",
  },
  1,
);
const oot = await supplier(
  "Orange O Tec Pvt Ltd",
  "OOT",
  "24AAHCM0016A1ZD",
  {
    line1: "7111/A2, Road No. 71, GIDC Sachin",
    city: "Surat",
    state: "Gujarat",
    pincode: "394230",
  },
  7,
);

// Catalogue: Sublimation · Eco · 29 GSM at 44″, 48″ and 60″.
const cats = await req("GET", "/api/catalogue/categories");
const quals = await req("GET", "/api/catalogue/qualities");
const products = await req("GET", "/api/catalogue/products");
const sub = cats.find((c) => c.code === "SUB");
const eco = quals.find((q) => q.name === "Eco");
let product = products.find(
  (p) => p.categoryId === sub.id && p.qualityId === eco.id && p.gsm === 29,
);
if (!product) {
  product = await req("POST", "/api/catalogue/products", {
    categoryId: sub.id,
    qualityId: eco.id,
    gsm: 29,
    defaultLengthM: 1000,
    widthsIn: [44, 48, 60],
  });
}
const sku = (w) => product.skus.find((s) => Number(s.widthIn) === w)?.id;
for (const w of [44, 48, 60]) {
  if (!sku(w))
    product = await req("POST", `/api/catalogue/products/${product.id}/skus`, { widthsIn: [w] });
}
const line = (w, description) => ({ skuId: sku(w), description, gsm: 29, widthIn: w });

// 1. Shree Balajee: PO → GRN → PI 2455 → freight.
let po = await req("POST", "/api/purchase-orders", {
  supplierId: sbc.id,
  date: today,
  lines: [
    { ...line(44, "Eco Papers 44* 29 GSM"), quantityM: 10000, ratePerM: "4.90", gstRate: "18" },
    { ...line(60, "Eco Paper 60* 29 GSM"), quantityM: 5000, ratePerM: "6.68", gstRate: "18" },
  ],
});
po = await req("POST", `/api/purchase-orders/${po.id}/approve`, { version: po.version });
let grn = await req("POST", "/api/goods-receipts", {
  supplierId: sbc.id,
  poId: po.id,
  date: today,
  supplierInvoiceNo: "2455",
  vehicleNo: "GJ01LT8440",
  lines: [
    { ...line(44, "Eco Papers 44* 29 GSM"), poLineId: po.lines[0].id, rolls: "10 X 1000 MTRS" },
    {
      ...line(60, "Eco Paper 60* 29 GSM"),
      poLineId: po.lines[1].id,
      rolls: "4 X 1000, 500+450 MTRS",
    },
  ],
});
grn = await req("POST", `/api/goods-receipts/${grn.id}/post`, {
  version: grn.version,
  approveOverReceipt: false,
});
let pi = await req("POST", "/api/purchase-invoices", {
  supplierId: sbc.id,
  supplierInvoiceNo: "2455",
  supplierInvoiceDate: today,
  poId: po.id,
  grnIds: [grn.id],
  ewayBillNo: "602205559183",
  roundOff: "0.12",
  lines: [
    {
      ...line(44, "Eco Papers 44* 29 GSM"),
      poLineId: po.lines[0].id,
      hsnCode: "48099000",
      quantityM: 10000,
      ratePerM: "4.90",
      gstRate: "18",
    },
    {
      ...line(60, "Eco Paper 60* 29 GSM"),
      poLineId: po.lines[1].id,
      hsnCode: "48099000",
      quantityM: 4950,
      ratePerM: "6.68",
      gstRate: "18",
    },
  ],
});
pi = await req("POST", `/api/purchase-invoices/${pi.id}/post`, { version: pi.version });
await req("POST", `/api/purchase-invoices/${pi.id}/landed-cost`, {
  charges: [
    { code: "FREIGHT", amount: "1200.00", vendorName: "Self (own vehicle)", billRef: "GJ01LT8440" },
    { code: "LOADING", amount: "300.00", vendorName: "Hamali" },
  ],
});

// 2. Orange O Tec: container CONT-13 received without a PO — rolls arrive Unmapped.
const oGrn = await req("POST", "/api/goods-receipts", {
  supplierId: oot.id,
  date: today,
  supplierInvoiceNo: "PAPER/022/26-27",
  supplierBatchRef: "CONT-13",
  vehicleNo: "MH05FJ5285",
  lines: [
    {
      description: "SUBLIMATION PAPER (29GSM*50IN*1000M)",
      gsm: 29,
      widthIn: 50,
      rolls: "6 x 1000",
    },
    {
      description: "SUBLIMATION PAPER (29GSM*46IN*1000M)",
      gsm: 29,
      widthIn: 46,
      rolls: "4 x 1000, 960",
    },
  ],
});
await req("POST", `/api/goods-receipts/${oGrn.id}/post`, {
  version: oGrn.version,
  approveOverReceipt: false,
});

// 3. A draft PO awaiting approval.
await req("POST", "/api/purchase-orders", {
  supplierId: oot.id,
  date: today,
  notes: "Next container — confirm rates before approving",
  lines: [
    {
      ...line(48, "SUBLIMATION PAPER (29GSM*48IN*1000M)"),
      quantityM: 50000,
      ratePerM: "5.33",
      gstRate: "18",
    },
  ],
});

await req("POST", "/api/inventory/stock/refresh");
console.log(
  `Purchase demo data added: ${po.poNo}, ${grn.grnNo} (${grn.rollCount} rolls), PI ${pi.supplierInvoiceNo} ₹${pi.totals.total}, CONT-13 unmapped lot.`,
);
