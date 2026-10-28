#!/usr/bin/env node
/**
 * Dev-only Stage 3 demo data, created through the running API (so every rule applies), on top of
 * the Stage 2 purchase demo (pnpm seed:purchase-demo → mapped 44″ / 60″ rolls):
 *  - an order confirmed, picked (FIFO + a cut), dispatched, invoiced and given its IRN
 *  - an order dispatched but not yet invoiced
 *  - an order held for credit, and a draft waiting for rate approval
 *  - a sent proforma, and a credit note for a rate difference
 * Needs the API on :3000 (with the IRN simulator) and DEMO_USER_* in .env. Refuses to run twice.
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
      "idempotency-key": crypto.randomUUID(),
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
const reason = (r) => ({ "x-change-reason": encodeURIComponent(r) });
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const stepUp = () => req("POST", "/api/identity/step-up", { password });

await req("POST", "/api/auth/sign-in/email", { email, password });
if ((await req("GET", "/api/sales-orders")).length) {
  console.log("Sales demo data already present — nothing changed.");
  process.exit(0);
}

// Stock: mapped rolls by SKU.
const stock = (await req("GET", "/api/rolls?status=Mapped&limit=500")).items;
const bySku = Map.groupBy(stock, (r) => r.skuId);
const [skuA, rollsA] = [...bySku.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
if (!skuA) throw new Error("No mapped stock — run the purchase demo seed first.");
const skuB = [...bySku.keys()].find((k) => k !== skuA) ?? skuA;
console.log(`Using ${rollsA.length} rolls of ${rollsA[0].description}`);

// Every category needs HSN / GST before invoicing (Q9); fill the paper default for the demo.
for (const c of await req("GET", "/api/catalogue/categories")) {
  if (!c.hsnCode || c.gstRate === null) {
    await req(
      "PATCH",
      `/api/catalogue/categories/${c.id}`,
      { ...c, hsnCode: c.hsnCode ?? "48239090", gstRate: c.gstRate ?? "18", version: c.version },
      reason("Demo: HSN for invoicing"),
    );
  }
}

const customers = (await req("GET", "/api/customers?active=true")).filter(
  (c) => c.gstin && !c.blocked,
);
// Credit headroom decides who gets which story (the demo user can't change limits).
for (const c of customers)
  c.headroom = Number((await req("GET", `/api/customers/${c.id}/credit-check`)).headroom);
const byRoom = [...customers].sort((x, y) => y.headroom - x.headroom);
const [main, second, third] = byRoom.filter((c) => c.stateCode === "24");
const other = byRoom.at(-1);

async function order(customerId, lines) {
  let so = await req("POST", "/api/sales-orders", { customerId, date: today, lines });
  if (so.pendingApproval) {
    await stepUp();
    so = await req("POST", `/api/sales-orders/${so.id}/approve-rates`, { version: so.version });
  }
  return req("POST", `/api/sales-orders/${so.id}/confirm`, { version: so.version });
}
async function rate(customerId, skuId) {
  const q = await req(
    "GET",
    `/api/sales-orders/rate-quote?customerId=${customerId}&skuId=${skuId}`,
  );
  return q.ratePerM ?? "6.00";
}

// 1. Main customer: 2,500 m → FIFO full rolls + a 500 m cut; dispatched, invoiced, IRN.
let so1 = await order(main.id, [
  { skuId: skuA, totalM: 2500, ratePerM: await rate(main.id, skuA), allowCut: true },
]);
let dc1 = await req("POST", "/api/delivery-challans", { soId: so1.id, date: today });
const alloc = await req("GET", `/api/sales-orders/${so1.id}/allocation`);
for (const r of alloc.lines[0].rolls)
  await req("POST", `/api/delivery-challans/${dc1.id}/pick`, {
    soLineId: so1.lines[0].id,
    rollId: r.rollId,
  });
if (alloc.lines[0].cut)
  await req("POST", `/api/delivery-challans/${dc1.id}/cut`, {
    soLineId: so1.lines[0].id,
    rollId: alloc.lines[0].cut.rollId,
    cutM: alloc.lines[0].cut.cutM,
    wasteM: 0,
  });
dc1 = await req("GET", `/api/delivery-challans/${dc1.id}`);
dc1 = await req("PATCH", `/api/delivery-challans/${dc1.id}`, {
  date: today,
  notes: null,
  version: dc1.version,
  vehicleNo: "GJ05AB1234",
  lrNo: "LR-2210",
  lrDate: today,
  distanceKm: 18,
});
dc1 = await req("POST", `/api/delivery-challans/${dc1.id}/post`, { version: dc1.version });
let si1 = await req("POST", "/api/sales-invoices", { source: "DC", dcIds: [dc1.id], date: today });
si1 = await req("POST", `/api/sales-invoices/${si1.id}/post`, { version: si1.version });
await req("POST", `/api/einvoice/SI/${si1.id}/generate`).catch((e) => console.warn(String(e)));

// 2. Second customer: 1,000 m dispatched, waiting to be invoiced.
const so2 = await order(second.id, [
  { skuId: skuB, totalM: 1000, ratePerM: await rate(second.id, skuB) },
]);
let dc2 = await req("POST", "/api/delivery-challans", { soId: so2.id, date: today });
const alloc2 = await req("GET", `/api/sales-orders/${so2.id}/allocation`);
for (const r of alloc2.lines[0].rolls)
  await req("POST", `/api/delivery-challans/${dc2.id}/pick`, {
    soLineId: so2.lines[0].id,
    rollId: r.rollId,
  });
dc2 = await req("GET", `/api/delivery-challans/${dc2.id}`);
if (dc2.rolls.length)
  await req("POST", `/api/delivery-challans/${dc2.id}/post`, { version: dc2.version });

// 3. The customer with the least headroom orders more than it: the order goes on hold.
const holdM = Math.max(1000, Math.ceil((other.headroom + 20000) / 6 / 100) * 100);
await order(other.id, [{ skuId: skuA, totalM: holdM, ratePerM: await rate(other.id, skuA) }]);

// 4. A draft with a rate 9 % over the derived one: waits for a manager.
const base = await rate(third.id, skuA);
await req("POST", "/api/sales-orders", {
  customerId: third.id,
  date: today,
  customerRef: "PO/7781",
  lines: [{ skuId: skuA, totalM: 1500, ratePerM: (Number(base) * 1.09).toFixed(2) }],
});

// 5. A sent proforma, and a credit note against the invoice.
let pf = await req("POST", "/api/proformas", {
  customerId: second.id,
  date: today,
  lines: [{ skuId: skuA, metres: 3000, ratePerM: await rate(second.id, skuA) }],
});
await req("POST", `/api/proformas/${pf.id}/send`, { version: pf.version });
await stepUp();
let cn = await req("POST", "/api/customer-notes", {
  kind: "CREDIT",
  customerId: main.id,
  siId: si1.id,
  date: today,
  reasonCode: "RATE_DIFFERENCE",
  reason: "Rate revised by ₹0.20/m after quality complaint",
  lines: [
    {
      description: "Rate difference on 2,500 m",
      hsnCode: "48239090",
      taxable: "500.00",
      gstRate: "18",
    },
  ],
});
cn = await req("POST", `/api/customer-notes/${cn.id}/post`, { version: cn.version });

console.log(
  `Sales demo data added: ${so1.soNo} → ${dc1.dcNo} → ${si1.siNo}; ${dc2.dcNo} to invoice; a held order; a draft awaiting approval; ${pf.proformaNo}; ${cn.noteNo}.`,
);
