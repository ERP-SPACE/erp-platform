import { createHash } from "node:crypto";
import { type DbHandle, idempotencyKeys } from "@erp/db";
import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants.js";
import { Reflector } from "@nestjs/core";
import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { type Observable, from, of, switchMap, tap, catchError, throwError } from "rxjs";
import { DB } from "../db/tokens.js";
import { requestContext } from "./context.js";
import { AppError } from "./errors.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Idempotency-Key support (CLAUDE.md rule 6). The first request with a key reserves it; a retry
 * with the same key and body replays the stored response; the same key with a different body is
 * rejected. Failed requests release the key so they can be retried.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const key = request.headers["idempotency-key"];
    const userId = requestContext.getStore()?.actor?.userId;
    if (!MUTATING.has(request.method) || typeof key !== "string" || !key || !userId) {
      return next.handle();
    }
    if (key.length > 100) throw new AppError(400, "VALIDATION_ERROR", "Idempotency-Key is too long.");

    const route = request.routeOptions.url ?? request.url;
    const requestHash = createHash("sha256")
      .update(`${request.method} ${request.url}\n${JSON.stringify(request.body ?? null)}`)
      .digest("hex");
    const status =
      this.reflector.get<number>(HTTP_CODE_METADATA, context.getHandler()) ??
      (request.method === "POST" ? HttpStatus.CREATED : HttpStatus.OK);
    const db = this.handle.db;
    const where = and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key));

    return from(
      db
        .insert(idempotencyKeys)
        .values({ userId, key, method: request.method, route, requestHash })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key }),
    ).pipe(
      switchMap(async (inserted) => {
        if (inserted.length > 0) return null;
        const [existing] = await db.select().from(idempotencyKeys).where(where);
        if (!existing) return null;
        if (existing.requestHash !== requestHash) {
          throw new AppError(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used for a different request.");
        }
        if (existing.statusCode === null) {
          throw new AppError(409, "IDEMPOTENCY_IN_PROGRESS", "The same request is still being processed.");
        }
        return existing;
      }),
      switchMap((replay) => {
        if (replay) {
          void reply.status(replay.statusCode!).header("idempotent-replay", "true");
          return of(replay.response);
        }
        return next.handle().pipe(
          tap((body) => {
            void db
              .update(idempotencyKeys)
              .set({ statusCode: status, response: (body ?? null) as never })
              .where(where)
              .execute();
          }),
          catchError((error: unknown) =>
            from(db.delete(idempotencyKeys).where(where)).pipe(switchMap(() => throwError(() => error))),
          ),
        );
      }),
    );
  }
}
