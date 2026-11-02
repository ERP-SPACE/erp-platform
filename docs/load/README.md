# Load test results

`pnpm load:test` (scripts/load-test.mjs + infra/load/daily-mix.js) builds a throwaway stack — database `erp_load` with the demo masters, the purchase and sales demos and rolls cloned to **50,000**, API on :3200 — and runs k6 (Docker image `grafana/k6:0.54.0`) with **45 virtual users** for 3 minutes: 3× the 15 people expected at peak (Q46). Five sales-manager users share the load (9 virtual users each, like a busy office), each signed in once. Each virtual user waits 1–3 s between actions, like a person.

The mix: 30 % barcode scans, 32 % lists (rolls, invoices, orders, receipts), 10 % credit checks, 6 % Today, 7 % reports, 10 % new proformas (writes).

## 2026-11-02 — Stage 6 gate

Machine: the development laptop (Windows 11, Docker Desktop / WSL2, Postgres 17 and Redis 7 in containers, API in Node 24 on the host).

| Request | p95 | Average | Max | Budget (CLAUDE.md) |
|---|---|---|---|---|
| Barcode scan | 22 ms | 18 ms | 45 ms | < 500 ms |
| Lists | 17 ms | 12 ms | 44 ms | < 300 ms |
| Credit check | 19 ms | 15 ms | 40 ms | < 1 s |
| Today | 53 ms | 43 ms | 87 ms | < 1.5 s |
| Reports (stock, batch aging, SKU sales) | 59 ms | 27 ms | 93 ms | < 300 ms |
| New proforma (write) | 45 ms | 34 ms | 80 ms | < 1 s |

4,678 requests (19.3 per second sustained), **0 failed**, all 4,675 checks passed; every threshold met. Raw summary: [`2026-11-02-k6.json`](2026-11-02-k6.json).

Notes:
- Sign-in is rate-limited per IP (20 a minute); a whole office behind one router signing in at 09:00 stays well under it, but a load test from one machine does not, so the wrapper signs each load user in once and k6 reuses the sessions.
- The per-user API limit (600 requests a minute) is never reached by a person; 9 virtual users on one account reach about 250.
- Stage 7 repeats this against the AWS stack (RDS, ElastiCache) before go-live.
