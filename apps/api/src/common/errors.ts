import type { ErrorCode, Problem } from "@erp/contracts";

/** Domain-level HTTP error rendered as problem+json by ProblemFilter. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly extra: Partial<Pick<Problem, "issues" | "current">> = {},
  ) {
    super(message);
  }
}

export const unauthenticated = () => new AppError(401, "UNAUTHENTICATED", "Please sign in.");
export const stepUpRequired = () =>
  new AppError(401, "STEP_UP_REQUIRED", "Please confirm your password to continue.");
export const totpEnrolmentRequired = () =>
  new AppError(403, "TOTP_ENROLMENT_REQUIRED", "Set up two-factor authentication to continue.");
export const forbidden = (what = "do this") =>
  new AppError(403, "FORBIDDEN", `You don't have permission to ${what}.`);
export const notFound = (what: string) => new AppError(404, "NOT_FOUND", `${what} not found.`);
export const reasonRequired = () =>
  new AppError(422, "REASON_REQUIRED", "A reason is required for this change.");
export const validationError = (message: string, issues?: Problem["issues"]) =>
  new AppError(400, "VALIDATION_ERROR", message, issues ? { issues } : {});
export const versionConflict = (current: NonNullable<Problem["current"]>) =>
  new AppError(
    409,
    "VERSION_CONFLICT",
    "This record was changed by someone else. Reload to see the latest version.",
    { current },
  );
