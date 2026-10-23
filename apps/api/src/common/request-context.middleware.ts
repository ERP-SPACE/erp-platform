import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { uuidv7 } from "uuidv7";
import { requestContext } from "./context.js";

const MAX_REASON_LENGTH = 500;

/** Opens the AsyncLocalStorage scope for the whole request (Nest ALS recipe). */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: IncomingMessage & { id?: string }, res: ServerResponse, next: () => void): void {
    const incoming = req.headers["x-request-id"];
    const requestId = (typeof incoming === "string" && incoming.length <= 64 && incoming) || req.id || uuidv7();
    res.setHeader("x-request-id", requestId);

    const rawReason = req.headers["x-change-reason"];
    let reason: string | undefined;
    if (typeof rawReason === "string" && rawReason.trim()) {
      try {
        reason = decodeURIComponent(rawReason).trim().slice(0, MAX_REASON_LENGTH);
      } catch {
        reason = rawReason.trim().slice(0, MAX_REASON_LENGTH);
      }
    }

    requestContext.run({ requestId, reason }, next);
  }
}
