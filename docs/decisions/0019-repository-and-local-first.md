# 0019 — One monorepo in ERP-SPACE; local-first, AWS later

- **Status:** Accepted (owner: "run and test locally first, then AWS"; repo naming delegated) — 2026-10-23
- **Date:** 2026-10-23

## Context
The owner wants to develop and test locally before moving to AWS, with a new repo in the `ERP-SPACE` GitHub org. The backend and frontend must stay reliably in step.

## Decision

**Repository:**
- **One private monorepo: `ERP-SPACE/erp-platform`**, holding `apps/api`, `apps/web`, `apps/worker`, and `packages/*`.
- Separate repos are rejected. Backend and frontend share `packages/contracts` (Zod + generated API client) and `packages/domain` (pricing/GST/rounding). In one repo, an API change that breaks the frontend fails CI in the same pull request, and both sides always deploy from the same commit.
- Legacy repos `erp_api` / `erp_web_app` stay untouched, for reference.

**Independence inside the monorepo:**
- Turborepo task graph with path-filtered CI jobs.
- Separate Docker images per app (`api`, `worker`, `web`).
- `CODEOWNERS` per app.
- Per-app versioning via changesets.

**Local-first development:**
- **Docker Compose:** `postgres:17`, `redis:7`, `minio` (S3-compatible storage for KYC/PDFs/exports), `mailpit` (email capture).
- `pnpm dev` runs api, worker, and web with hot reload. `pnpm db:reset` migrates and seeds.
- **Storage, email, and e-invoice** sit behind adapters: S3 ↔ MinIO, SES ↔ Mailpit, IRP sandbox (ADR-0011).
- **Twelve-factor config** (env vars validated with Zod at boot), so moving to AWS is a configuration change, not a code change.

**CI (GitHub Actions):**
- lint → typecheck → unit → integration (Postgres/Redis service containers) → E2E (Playwright against Compose).
- No deploy job until the AWS stage.

**AWS:** Terraform + ECS/RDS/ElastiCache/S3 move to a new **Stage 7 — Cloud deployment**, after the owner signs off on local UAT.

## Prerequisites on the developer machine
- Docker Desktop (WSL2 backend)
- Node 22 LTS (Node 24 currently installed — works, but CI pins 22)
- pnpm 10+
- GitHub CLI (`gh`) authenticated with access to `ERP-SPACE`
