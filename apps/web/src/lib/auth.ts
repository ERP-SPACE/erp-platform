import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Better Auth client (ADR-0021). Sign-in, sign-out and TOTP enrolment go through /api/auth/*. */
export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? "http://localhost" : window.location.origin,
  basePath: "/api/auth",
  plugins: [twoFactorClient()],
});
