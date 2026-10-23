import type { PermissionCode } from "@erp/contracts";
import { SetMetadata } from "@nestjs/common";

export const PUBLIC_KEY = "erp:public";
export const PERMISSIONS_KEY = "erp:permissions";
export const FRESH_AUTH_KEY = "erp:fresh-auth";
export const ALLOW_WITHOUT_TOTP_KEY = "erp:allow-without-totp";
export const REQUIRE_REASON_KEY = "erp:require-reason";

/** No session needed (health checks). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Every listed permission is required. */
export const RequirePermission = (...codes: PermissionCode[]) => SetMetadata(PERMISSIONS_KEY, codes);

/** Sensitive action: the user must have authenticated within STEP_UP_SECONDS (ADR-0021). */
export const RequireFreshAuth = () => SetMetadata(FRESH_AUTH_KEY, true);

/** Reachable while an Owner has not yet enrolled TOTP (so they can enrol). */
export const AllowWithoutTotp = () => SetMetadata(ALLOW_WITHOUT_TOTP_KEY, true);

/** A non-empty X-Change-Reason header is mandatory (PRD §4.2 sensitive actions). */
export const RequireReason = () => SetMetadata(REQUIRE_REASON_KEY, true);
