import { SETTINGS, parseSetting } from "@erp/contracts";
import { type DbHandle, settings } from "@erp/db";
import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { type Observable, from, switchMap } from "rxjs";
import { DB } from "../db/tokens.js";
import { REDIS } from "../redis/redis.module.js";
import { requestContext } from "./context.js";
import { AppError } from "./errors.js";

/** Heavy actions get their own, smaller per-minute budgets on top of the general one. */
const BUCKETS: {
  name: string;
  perMinute: number;
  match: (method: string, path: string) => boolean;
}[] = [
  { name: "export", perMinute: 10, match: (m, p) => m === "POST" && p === "/api/reports/exports" },
  { name: "refresh", perMinute: 6, match: (m, p) => m === "POST" && p === "/api/reports/refresh" },
  { name: "pdf", perMinute: 60, match: (_m, p) => p.endsWith("/pdf") },
  { name: "upload", perMinute: 20, match: (m, p) => m === "POST" && p === "/api/opening/uploads" },
];
const CACHE_MS = 60_000;

/**
 * Per-user API rate limits (Stage 6 hardening). Runs after the auth guard, so it counts signed-in
 * users only (sign-in itself has its own limit). Fixed one-minute windows in Redis:
 * `api.rateLimitPerMinute` (default 600) for everything, plus smaller budgets for exports,
 * Refresh now, PDFs and opening uploads. Over the limit: 429 RATE_LIMITED with Retry-After.
 */
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private limit: { companyId: string; value: number; at: number } | null = null;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly handle: DbHandle,
  ) {}

  private async generalLimit(companyId: string): Promise<number> {
    if (this.limit && this.limit.companyId === companyId && Date.now() - this.limit.at < CACHE_MS) {
      return this.limit.value;
    }
    const [row] = await this.handle.db
      .select({ value: settings.value })
      .from(settings)
      .where(and(eq(settings.companyId, companyId), eq(settings.key, "api.rateLimitPerMinute")));
    const value = parseSetting(
      "api.rateLimitPerMinute",
      row?.value ?? SETTINGS["api.rateLimitPerMinute"].default,
    );
    this.limit = { companyId, value, at: Date.now() };
    return value;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const actor = requestContext.getStore()?.actor;
    if (!actor || context.getType() !== "http") return next.handle();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const path = request.url.split("?")[0]!;
    return from(this.check(actor.userId, actor.companyId, request.method, path, reply)).pipe(
      switchMap(() => next.handle()),
    );
  }

  private async check(
    userId: string,
    companyId: string,
    method: string,
    path: string,
    reply: FastifyReply,
  ) {
    const minute = Math.floor(Date.now() / 60_000);
    const retryAfter = 60 - Math.floor((Date.now() / 1000) % 60);
    const checks = [
      { name: "api", perMinute: await this.generalLimit(companyId) },
      ...BUCKETS.filter((b) => b.match(method, path)),
    ];
    for (const b of checks) {
      const key = `erp:rl:${b.name}:${userId}:${minute}`;
      const [[, count]] = (await this.redis.multi().incr(key).expire(key, 70).exec()) as [
        [null, number],
      ];
      if (count > b.perMinute) {
        void reply.header("retry-after", String(retryAfter));
        throw new AppError(
          429,
          "RATE_LIMITED",
          b.name === "api"
            ? "Too many requests. Wait a moment and try again."
            : `Too many ${b.name === "pdf" ? "PDFs" : b.name === "refresh" ? "refreshes" : `${b.name}s`} in a minute. Wait a moment and try again.`,
        );
      }
    }
  }
}
