// k6 load test (Stage 6 hardening, Q46): 3× the expected peak — 45 virtual users for 15 people —
// on the realistic daily mix: barcode scans, roll and document lists, credit checks, Today,
// reports and new proformas. Run through `pnpm load:test` (scripts/load-test.mjs), which builds
// a throwaway stack with 50,000 rolls; budgets are the CLAUDE.md ones.
import { check, sleep } from "k6";
import http from "k6/http";

const BASE = __ENV.BASE_URL;
const ORIGIN = __ENV.ORIGIN;
const PEAK = Number(__ENV.VUS || 45);

export const options = {
  scenarios: {
    daily: {
      executor: "ramping-vus",
      stages: [
        { duration: "45s", target: PEAK },
        { duration: __ENV.HOLD || "3m", target: PEAK },
        { duration: "15s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    "http_req_duration{name:scan}": ["p(95)<500"],
    "http_req_duration{name:credit}": ["p(95)<1000"],
    "http_req_duration{name:list}": ["p(95)<300"],
    "http_req_duration{name:today}": ["p(95)<1500"],
    "http_req_duration{name:report}": ["p(95)<300"],
    "http_req_duration{name:write}": ["p(95)<1000"],
    http_req_failed: ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "max"],
};

// Sessions come from the wrapper (scripts/load-test.mjs): each load user signed in once, as
// people stay signed in all day; sign-in itself is rate-limited per IP.
const SESSIONS = JSON.parse(__ENV.LOAD_SESSIONS || "[]");
const withSession = (n, extra = {}) => ({
  headers: { origin: ORIGIN, cookie: SESSIONS[n % SESSIONS.length], ...extra },
});

export function setup() {
  const get = (path) => http.get(`${BASE}${path}`, withSession(0)).json();
  const barcodes = get("/api/rolls?status=Mapped&limit=500").items.map((r) => r.barcode);
  const customers = get("/api/customers?active=true").map((c) => c.id);
  const skus = get("/api/catalogue/products").flatMap((p) => p.skus.map((x) => x.id));
  return { barcodes, customers, skus };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export default function (data) {
  const roll = Math.random();
  const get = (path, name) => http.get(`${BASE}${path}`, { ...withSession(__VU), tags: { name } });
  let res;
  if (roll < 0.3) res = get(`/api/rolls/${pick(data.barcodes)}`, "scan");
  else if (roll < 0.45) res = get("/api/rolls?status=Mapped&limit=100", "list");
  else if (roll < 0.55) res = get("/api/sales-invoices", "list");
  else if (roll < 0.62) res = get("/api/sales-orders", "list");
  else if (roll < 0.67) res = get("/api/receipts", "list");
  else if (roll < 0.77) res = get(`/api/customers/${pick(data.customers)}/credit-check`, "credit");
  else if (roll < 0.83) res = get("/api/today", "today");
  else if (roll < 0.9)
    res = get(
      pick([
        "/api/reports/stock-by-sku",
        "/api/reports/batch-aging?pageSize=100",
        "/api/reports/sku-sales",
      ]),
      "report",
    );
  else {
    res = http.post(
      `${BASE}/api/proformas`,
      JSON.stringify({
        customerId: pick(data.customers),
        date: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10),
        lines: [{ skuId: pick(data.skus), metres: 1000, ratePerM: "7.00" }],
      }),
      {
        headers: {
          ...withSession(__VU, { "content-type": "application/json" }).headers,
          "idempotency-key": `${__VU}-${__ITER}-${Date.now()}`,
        },
        tags: { name: "write" },
      },
    );
  }
  const ok = check(res, { "2xx": (r) => r.status >= 200 && r.status < 300 });
  if (!ok && __ITER < 2)
    console.warn(
      `${res.request.method} ${res.url} → ${res.status} ${String(res.body).slice(0, 160)}`,
    );
  // People think between actions: 1–3 s.
  sleep(1 + Math.random() * 2);
}
