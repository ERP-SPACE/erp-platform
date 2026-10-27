/**
 * Error codes returned in problem+json bodies (`{ type, title, status, code, detail, ... }`).
 * The web app switches on `code`, never on message text.
 */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "STEP_UP_REQUIRED",
  "TOTP_ENROLMENT_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "DUPLICATE",
  "OVERLAP",
  "APPROVAL_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "IDEMPOTENCY_IN_PROGRESS",
  "INVALID_STATE_TRANSITION",
  "INVALID_SERIES",
  "INVALID_AMOUNT",
  "REASON_REQUIRED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  requestId?: string;
  /** Field-level validation issues. */
  issues?: { path: string; message: string }[];
  /** VERSION_CONFLICT details. */
  current?: { version: number; updatedBy: string | null; updatedAt: string };
}
