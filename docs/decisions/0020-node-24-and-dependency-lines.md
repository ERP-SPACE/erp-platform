# 0020 — Node 24 LTS and pinned dependency major lines

- **Status:** Accepted (amends ADR-0001)
- **Date:** 2026-10-23

## Context
ADR-0001 named Node 22 LTS. Node 24 is now the Active LTS line, and it is what is installed on the development machine. Several dependencies have very recent major releases: TypeScript 7 (native compiler), NestJS 12, Vite 8, Vitest 5, TanStack Table 9, BullMQ 6, and ioredis 6. `nestjs-zod` still supports only NestJS 10/11.

## Decision
- **Runtime:** Node `>=24 <25` (`.nvmrc` = 24), with `packageManager: pnpm@11.25.0`.
- **Pinned to proven major lines:**

  | Package | Line |
  |---|---|
  | TypeScript | 6.0 (last compiler with full `emitDecoratorMetadata` support, which NestJS DI relies on) |
  | NestJS | 11 |
  | Vite | 7 |
  | Vitest | 4 |
  | TanStack Table | 8 |
  | BullMQ | 5 |
  | ioredis | 5 |
  | ESLint | 9 |
  | Testcontainers | 11 |

- **Latest releases** are used where they are mature and fully compatible: React 19.3, Zod 4, Drizzle ORM 0.45, Better Auth 1.7, Tailwind 4.3, TanStack Router/Query, and Playwright.
- **Exact versions** are fixed by `pnpm-lock.yaml`.

## Consequences
After Stage 6, a dedicated "dependency majors" chore will evaluate TypeScript 7, NestJS 12, and Vite 8 behind the full test suite. Nothing is upgraded mid-stage.
