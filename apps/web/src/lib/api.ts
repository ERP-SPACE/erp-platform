import type { ApiPaths, ErrorCode, Problem } from "@erp/contracts";
import createClient, { type Middleware } from "openapi-fetch";

/** A failed API call, carrying the server's problem+json body (contracts/errors.ts). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem,
  ) {
    super(problem.title);
  }
  get code(): ErrorCode {
    return this.problem.code;
  }
  /** Field errors keyed by path, ready for react-hook-form `setError`. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem.issues ?? []).map((i) => [i.path, i.message]));
  }
}

const idempotency: Middleware = {
  onRequest({ request }) {
    if (request.method !== "GET" && !request.headers.has("idempotency-key")) {
      request.headers.set("idempotency-key", crypto.randomUUID());
    }
    return request;
  },
};

export const api = createClient<ApiPaths>({
  baseUrl: typeof window === "undefined" ? "http://localhost" : window.location.origin,
  credentials: "include",
});
api.use(idempotency);

/** Set by <StepUpProvider>: asks the user to re-confirm, resolves true when they did. */
let stepUpHandler: (() => Promise<boolean>) | null = null;
export function registerStepUpHandler(handler: (() => Promise<boolean>) | null): void {
  stepUpHandler = handler;
}

type Result<T> = { data?: T; error?: unknown; response: Response };

/**
 * Unwraps an openapi-fetch call. On STEP_UP_REQUIRED it asks the user to confirm their password
 * (and TOTP) and retries once; every other failure becomes an ApiError.
 */
export async function call<T>(run: () => Promise<Result<T>>): Promise<T> {
  let result = await run();
  if (
    result.error &&
    result.response.status === 401 &&
    (result.error as Problem).code === "STEP_UP_REQUIRED" &&
    stepUpHandler
  ) {
    if (await stepUpHandler()) result = await run();
  }
  if (result.error !== undefined || !result.response.ok) {
    const problem = (result.error as Problem | undefined) ?? {
      type: "about:blank",
      title: result.response.statusText || "Request failed",
      status: result.response.status,
      code: "INTERNAL_ERROR",
    };
    throw new ApiError(result.response.status, problem);
  }
  return result.data as T;
}

/** Header for an audited change's reason (X-Change-Reason, CLAUDE.md rule 7). */
export function reasonHeader(reason: string | undefined): Record<string, string> {
  return reason?.trim() ? { "x-change-reason": encodeURIComponent(reason.trim()) } : {};
}
