# 0001 — Modular monolith on TypeScript, NestJS/Fastify, PostgreSQL + Drizzle

- **Status:** Accepted
- **Date:** 2026-10-23

## Context
The legacy build (Express + MongoDB, untyped JS) wrote multi-document business operations without transactions and stored money as floats. That produced real bugs (port matrix 3.1, 3.2). The usage profile is fewer than 15 concurrent users at a single hub, with strict auditability needs.

## Decision
- **Code organisation:**
  - A **modular monolith** in a pnpm + Turborepo monorepo: `apps/api` (NestJS 11 on Fastify), `apps/worker` (BullMQ), `apps/web` (React 19 + Vite + TanStack).
  - Shared packages: `packages/domain` (pure business logic), `packages/contracts` (Zod + OpenAPI client), `packages/db` (Drizzle schema and migrations), `packages/ui`.
- **Storage and jobs:**
  - **PostgreSQL 17** (RDS, ap-south-1) replaces MongoDB.
  - **Redis** for jobs, cache, and SSE fan-out.
- **Boundaries:** modules interact only via their public services, with no cross-module table writes.

## Consequences
- ACID transactions for every posting; DB-level constraints (CHECK, EXCLUDE, partial unique); SQL for reporting.
- One deployable API plus one worker; low ops load.
- Any legacy logic worth keeping must be re-implemented in TS with tests (see `docs/legacy-port-matrix.md`).
