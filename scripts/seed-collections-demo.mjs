#!/usr/bin/env node
/**
 * Dev-only Stage 4 demo data through the running API, on top of the purchase and sales demos:
 *  - a commission rule (1 % on posting) and a fresh invoice for the first sales-demo customer
 *  - an NEFT receipt applied oldest-first with a little left on account
 *  - a cheque receipt that bounced, from another customer
 *  - a part payment to the purchase-demo supplier, and the nightly credit check
 * Needs the API on :3000 and DEMO_USER_* in .env. Refuses to run twice.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));
const API = process.env.DEMO_API_URL ?? "http://localhost:3000";
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const { DEMO_USER_EMAIL: email, DEMO_USER_PASSWORD: password } = process.env;
if (!email || !password) throw new Error("Set DEMO_USER_EMAIL / DEMO_USER_PASSWORD in .env");

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
if ((await req("GET", "/api/receipts")).length) {
  console.log("Collections demo data already present — nothing changed.");
  process.exit(0);
}

const invoices = (await req("GET", "/api/sales-invoices?status=Posted")).sort((a, b) =>
  a.siNo.localeCompare(b.siNo),
);
if (!invoices.length) throw new Error("No posted invoices — run the sales demo seed first.");
const main = invoices[0].customerId;
const customer = await req("GET", `/api/customers/${main}`);

// Commission: 1 % on posting for the customer's salesman, then a new invoice that earns it.
if (customer.salesmanId) {
  await req("POST", `/api/salesmen/${customer.salesmanId}/commission-rules`, {
    customerId: main,
    method: "PERCENT_SALES",
    rate: "1",
    triggerEvent: "ON_SI_POSTED",
    validFrom: today,
  });
  const stock = (await req("GET", "/api/rolls?status=Mapped&limit=50")).items;
  if (stock.length) {
    const q = await req(
      "GET",
      `/api/sales-orders/rate-quote?customerId=${main}&skuId=${stock[0].skuId}`,
    );
    let pf = await req("POST", "/api/proformas", {
      customerId: main,
      date: today,
      lines: [
        { skuId: stock[0].skuId, metres: stock[0].currentLengthM, ratePerM: q.ratePerM ?? "6.40" },
      ],
    });
    pf = await req("POST", `/api/proformas/${pf.id}/send`, { version: pf.version });
    const draft = await req("POST", "/api/sales-invoices", {
      source: "PROFORMA",
      proformaId: pf.id,
      date: today,
      rolls: [{ lineId: pf.lines[0].id, rollId: stock[0].id }],
    });
    await req("POST", `/api/sales-invoices/${draft.id}/post`, { version: draft.version });
  }
}

// NEFT receipt: oldest invoices first, a round sum with a little left on account.
const open = await req("GET", `/api/customers/${main}/open-items`);
const owed = open.invoices.reduce((s, i) => s + Number(i.outstanding), 0);
const amount = (Math.floor(owed / 5000) * 5000 + 2500).toFixed(2);
const suggestion = await req(
  "GET",
  `/api/customers/${main}/allocation-suggestion?amount=${amount}`,
);
let r1 = await req("POST", "/api/receipts", {
  partyId: main,
  date: today,
  mode: "NEFT",
  amount,
  reference: "HDFCN26301123456",
  allocations: suggestion.lines,
});
r1 = await req("POST", `/api/receipts/${r1.id}/post`, { version: r1.version });

// A cheque from another customer that bounced.
const other = invoices.find((i) => i.customerId !== main);
if (other) {
  let r2 = await req("POST", "/api/receipts", {
    partyId: other.customerId,
    date: today,
    mode: "CHEQUE",
    amount: "5000.00",
    reference: "004521",
    bankName: "State Bank of India",
    allocations: [{ invoiceId: other.id, amount: "5000.00" }],
  });
  r2 = await req("POST", `/api/receipts/${r2.id}/post`, { version: r2.version });
  await stepUp();
  await req(
    "POST",
    `/api/receipts/${r2.id}/reverse`,
    { version: r2.version, kind: "BOUNCED" },
    reason("Returned unpaid: funds insufficient"),
  );
}

// Part payment to the purchase-demo supplier.
const pis = (await req("GET", "/api/purchase-invoices")).filter((p) => p.status === "Posted");
if (pis.length) {
  const pi = pis[0];
  let p = await req("POST", "/api/supplier-payments", {
    partyId: pi.supplierId,
    date: today,
    mode: "RTGS",
    amount: "50000.00",
    reference: "RTGS26301777",
    allocations: [{ invoiceId: pi.id, amount: "50000.00" }],
  });
  p = await req("POST", `/api/supplier-payments/${p.id}/post`, { version: p.version });
}

// Needs customers.credit.manage; skipped for users without it (the 02:00 job runs anyway).
const nightly = await req("POST", "/api/credit/nightly-check", {}).catch(() => "skipped");
console.log(
  `Collections demo data added: ${r1.docNo} (₹${amount}), a bounced cheque, a supplier payment; nightly check: ${JSON.stringify(nightly)}.`,
);
