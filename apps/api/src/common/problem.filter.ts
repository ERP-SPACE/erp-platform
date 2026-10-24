import {
  InvalidAmountError,
  InvalidPricingError,
  InvalidSeriesError,
  InvalidTransitionError,
} from "@erp/domain";
import type { ErrorCode, Problem } from "@erp/contracts";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ZodValidationException } from "nestjs-zod";
import { type ZodError } from "zod";
import { requestContext } from "./context.js";
import { AppError } from "./errors.js";
import { fromPgError } from "./pg-errors.js";

const STATUS_CODES: Record<number, ErrorCode> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "VERSION_CONFLICT",
};

/** Renders every error as RFC 9457 problem+json with a stable `code` (contracts/errors.ts). */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger("Problem");

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const problem = this.toProblem(exception);
    problem.requestId = requestContext.getStore()?.requestId;
    if (problem.status >= 500) this.logger.error(exception);
    void reply
      .status(problem.status)
      .header("content-type", "application/problem+json")
      .send(problem);
  }

  private toProblem(e: unknown): Problem {
    const make = (
      status: number,
      code: ErrorCode,
      title: string,
      extra: Partial<Problem> = {},
    ): Problem => ({
      type: `https://erp.local/problems/${code.toLowerCase().replace(/_/g, "-")}`,
      title,
      status,
      code,
      ...extra,
    });

    if (e instanceof AppError) return make(e.status, e.code, e.message, e.extra);
    const pg = fromPgError(e);
    if (pg) return make(pg.status, pg.code, pg.message, pg.extra);
    if (e instanceof ZodValidationException) {
      const zodError = e.getZodError() as ZodError;
      return make(400, "VALIDATION_ERROR", "Some fields are invalid.", {
        issues: zodError.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (e instanceof InvalidTransitionError) return make(422, e.code, e.message);
    if (e instanceof InvalidSeriesError) return make(400, e.code, e.message);
    if (e instanceof InvalidAmountError) return make(400, e.code, e.message);
    if (e instanceof InvalidPricingError) return make(400, e.code, e.message);
    if (e instanceof HttpException) {
      const status = e.getStatus();
      return make(status, STATUS_CODES[status] ?? "INTERNAL_ERROR", e.message);
    }
    return make(500, "INTERNAL_ERROR", "Something went wrong. The error has been logged.");
  }
}
