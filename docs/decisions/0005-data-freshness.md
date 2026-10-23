# 0005 — Data freshness: live where it matters, 3-minute analytics

- **Status:** Accepted
- **Date:** 2026-10-23

## Decision
| Data | How it is kept current | Freshness |
|---|---|---|
| Credit check, roll availability, document status | Computed in the request path | Live |
| Shared boards (Sales Board, Unmapped staging, DC pending) | Domain events → Redis pub/sub → SSE → TanStack Query invalidation | Seconds |
| Analytics | Materialized views refreshed `CONCURRENTLY` by a BullMQ job **every 3 min** from 08:00 to 20:00 IST, every 30 min otherwise | ≤ 3 min |
| Dead stock, unmapped age, overdue/grace | Nightly job, plus the live check at SO confirm | Daily |

Every analytic surface shows "as of HH:MM" and offers a manual refresh. 3 minutes was chosen over 5: it comfortably meets the PRD KPI (≤ 5 min) at negligible cost for this data size.
