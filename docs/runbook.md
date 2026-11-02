# Runbook — Gulmohar Creation ERP

How to run, update, back up, restore and look after the ERP. Written for the person who keeps the server running (the office IT person, or us). Commands run from the repository root unless noted.

> **Where it runs.** Until Stage 7 the ERP runs on one machine: Docker Desktop provides Postgres 17, Redis 7 and Mailpit; Node runs the API, the worker and the web app. Stage 7 moves it to AWS (ECS, RDS, ElastiCache, S3) and fills in the **Cloud** sections marked below.

## 1. The parts

| Part | What it does | Port | Started by |
|---|---|---|---|
| Postgres 17 | All business data, the audit log | 5433 | `pnpm db:up` |
| Redis 7 | Job queues, rate limits, live status | 6380 | `pnpm db:up` |
| API (`apps/api`) | Everything the screens call; also runs the IRN, credit re-check and export queues (`API_JOBS=true`) | 3000 | `pnpm dev` or `pnpm --filter @erp/api start` |
| Worker (`apps/worker`) | PDFs and labels (Chromium), analytics refresh every 3 min, nightly backup 01:30, audit archival on the 1st, housekeeping | — | `pnpm dev` or `pnpm --filter @erp/worker start` |
| Web (`apps/web`) | The office screens and `/floor` | 5173 (dev) | `pnpm dev`, or `vite preview` of a build |

Health: `GET /api/healthz` (process up), `GET /api/readyz` (database and Redis reachable). The worker writes a heartbeat every minute (Redis key `erp:worker:heartbeat`, 3-minute expiry); the last backup result is in `erp:backup:last`.

## 2. First-time setup

1. Install Docker Desktop (WSL2), Node 24 LTS and pnpm 11 (ADR-0019, ADR-0020).
2. `pnpm install`
3. `pnpm setup:local` — writes `.env` with generated secrets and the first Owner password (`SEED_OWNER_PASSWORD`). **Keep `.env` private; it is never committed.**
4. `pnpm db:up` then `pnpm db:reset` (creates, migrates and seeds the database).
5. `pnpm dev` and open http://localhost:5173. The Owner signs in and must turn on two-step verification (TOTP) the first time.

## 3. Daily operation

- **Start:** `pnpm db:up`, then the API, the worker and the web app (`pnpm dev` starts all three).
- **Stop:** stop the Node processes; `pnpm db:down` stops the containers (data stays in the Docker volume).
- **Is it healthy?** `/api/readyz` answers 200; the Today page's "as of" time is under 3 minutes old in business hours (08:00–20:00 IST); `pnpm db:restore-drill` passes weekly.

## 4. Updating to a new version

1. Take a backup: `pnpm db:backup`.
2. `git pull` (or check out the release tag), then `pnpm install`.
3. `pnpm db:migrate` — migrations only move forward and run in one transaction each.
4. `pnpm --filter @erp/db seed` — idempotent; adds new permissions, settings and document series to an existing database (needed after Stages 5 and 6).
5. `pnpm build`, restart the API, worker and web.
6. Check `/api/readyz`, sign in, open Today.

## 5. Rolling back

Migrations are forward-only. To undo a bad release:

1. Stop the API and worker.
2. Check out the previous release, `pnpm install && pnpm build`.
3. If the new release changed the database (`packages/db/migrations` differs), restore the backup taken in step 4.1 (section 7). Anything entered since that backup must be re-entered — tell users before you start.
4. Start everything and check `/api/readyz`.

## 6. Backups

- **Nightly, automatic:** the worker runs `scripts/db-backup.mjs` at 01:30 IST. Each backup is a `pg_dump` custom-format file in `.backups/` with a manifest (size, SHA-256, row counts, migration level). Kept for `backup.retentionDays` (Settings → System, default 30); the newest is never deleted.
- **By hand:** `pnpm db:backup` (before every update).
- **Off the machine:** copy `.backups/` to another disk or the office NAS daily. A backup on the same disk does not survive a disk failure. *(Cloud: RDS keeps 30 days of point-in-time recovery; S3 holds the files.)*
- **Uploaded files** (KYC documents, exports, archived audit months) live in `.storage/`; back it up with `.backups/`.

## 7. Restoring

**The drill (weekly, and before go-live):** `pnpm db:restore-drill` restores the newest backup into a scratch database `erp_restore_drill`, checks it (checksum, row counts, migration level, customer ledger against invoices and receipts, stock value across views, audit log permissions) and prints PASS/FAIL; the report is saved beside the backup. `--keep` leaves the scratch database for a look; `--file <name>` drills an older backup.

**A real restore** (data lost or damaged):

1. Stop the API and worker so nothing writes.
2. Note the time and what was entered after the backup you will restore.
3. Drill the backup first: `pnpm db:restore-drill --file <name>` must PASS.
4. Restore over the live database (Postgres runs in Docker):
   ```
   docker compose -f infra/docker/docker-compose.yml exec -T postgres psql -U postgres -c "DROP DATABASE erp WITH (FORCE)"
   docker compose -f infra/docker/docker-compose.yml exec -T postgres psql -U postgres -c "CREATE DATABASE erp OWNER erp_owner"
   docker compose -f infra/docker/docker-compose.yml exec -T postgres pg_restore -U postgres -d erp --exit-on-error < .backups/<name>.dump
   ```
5. Start the API and worker; check `/api/readyz`; open Today and a customer statement.
6. Re-enter what happened after the backup; document numbers continue from the restored sequences.

*(Cloud: restore an RDS snapshot or point in time to a new instance and switch the API's `DATABASE_URL`.)*

## 8. Rotating secrets

| Secret | Where | How | Effect |
|---|---|---|---|
| `AUTH_SECRET` | `.env` | Replace with 32 random bytes (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`), restart the API | Everyone is signed out |
| Database passwords (`erp_owner`, `erp_app`) | `.env` URLs | `ALTER ROLE erp_app PASSWORD '…'` as `postgres`, update `DATABASE_URL` / `DATABASE_OWNER_URL`, restart | None if done together |
| A user's password | Settings → Users & roles | The user changes it; an admin can reset it | — |
| Owner TOTP | — | If the Owner loses the phone: use a backup code; then turn two-step verification off and on again at `/setup-2fa` | — |
| NIC e-invoice credentials (`NIC_*`) | `.env` | Replace, restart the API | IRN calls use the new ones |

Rotate `AUTH_SECRET` and the database passwords when someone with server access leaves.

## 9. Common problems

| Symptom | Likely cause | Fix |
|---|---|---|
| Today's "as of" is old | Worker stopped | Start the worker; it refreshes on the next 3-minute slot (or press **Refresh now** on Reports) |
| PDFs say "couldn't be made right now" | Worker stopped or Chromium missing | Start the worker; `pnpm --filter @erp/worker exec playwright-core install chromium` |
| IRN stuck on Pending | NIC portal down, or API started with `API_JOBS=false` | It retries with backoff and a 15-minute sweep (up to 12 tries); check **Sales → IRN queue**; retry by hand there |
| Exports stay "Building" | API jobs off | Start an API with `API_JOBS=true` (the default) |
| "Too many requests" (429) | Per-user limit (Settings → System, default 600/min; exports 10/min) | Wait a minute; raise the setting if a real workload needs it |
| "Opening balances are locked" | The company is live | Correct with a credit/debit note or a stock adjustment with a reason |
| A queue seems stuck | A crashed job holds a lock | Restart the API / worker; BullMQ resumes stalled jobs. Inspect with `docker compose … exec redis redis-cli KEYS 'bull:*'` |
| Docker containers stopped | Docker Desktop not running | Start Docker Desktop, then `pnpm db:up` |

## 10. Users and access

- Add people in **Settings → Users & roles**; give the smallest role that fits (Owner, Admin, Purchase Manager, Sales Manager, Sales Executive, Warehouse, Accountant).
- Sensitive actions ask for the password again (step-up): credit release, rate overrides, reversals, cancelling invoices, paying commission, big supplier payments, going live, user and role changes.
- Customer scoping ("own customers", customer groups) limits what a user sees everywhere: lists, documents, reports, exports. *(Scopes are set in the database today (`user_scopes`); a screen for them is on the follow-up list.)*
- Deactivate (don't delete) people who leave; rotate secrets (section 8) if they had server access.

## 11. Go-live day

1. Owner sets **Settings → General → Go-live date** (opening balances are dated the day before).
2. `pnpm db:backup`, then `pnpm db:restore-drill` — must PASS.
3. Accounts imports opening stock, receivables, payables and bank/cash in **Settings → Opening balances**; each chapter is confirmed against the old books to the paisa.
4. Owner reviews and presses **Go live** (or the first live document on/after the go-live date locks it).
5. Print labels for opening stock that got new barcodes.
6. Backup again.

## 12. Cloud (Stage 7)

*To be written with the Terraform: AWS account and region (ap-south-1), deploy pipeline (GitHub Actions → ECR → ECS), RDS point-in-time restore, secrets in AWS Secrets Manager, CloudWatch alarms, S3 lifecycle for exports and archives.*
