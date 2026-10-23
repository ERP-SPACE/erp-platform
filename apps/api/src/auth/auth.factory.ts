import { account, type DbHandle, session, twoFactor as twoFactorTable, user, verification } from "@erp/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Env } from "../config/env.js";

export const AUTH = Symbol("AUTH");

/** Better Auth handles authentication only (ADR-0021); authorisation lives in our RBAC tables. */
export function createAuth(env: Env, handle: DbHandle) {
  return betterAuth({
    appName: "Paper Trading ERP",
    baseURL: env.API_PUBLIC_URL,
    basePath: "/api/auth",
    secret: env.AUTH_SECRET,
    trustedOrigins: [env.WEB_ORIGIN],
    database: drizzleAdapter(handle.db, {
      provider: "pg",
      schema: { user, session, account, verification, twoFactor: twoFactorTable },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // users are created by Owner/Admin only
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 12, // a working day
      updateAge: 60 * 60,
      freshAge: env.STEP_UP_SECONDS,
    },
    user: {
      additionalFields: {
        companyId: { type: "string", required: false, input: false },
        active: { type: "boolean", required: false, input: false, defaultValue: true },
        mustChangePassword: { type: "boolean", required: false, input: false, defaultValue: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Deactivated users cannot start a session.
          before: async (newSession) => {
            const rows = await handle.db
              .select({ active: user.active })
              .from(user)
              .where(eq(user.id, newSession.userId));
            return rows[0]?.active ? { data: newSession } : false;
          },
        },
      },
    },
    plugins: [twoFactor({ issuer: "Paper Trading ERP" })],
    advanced: {
      cookiePrefix: "erp",
      useSecureCookies: env.NODE_ENV === "production",
      defaultCookieAttributes: { sameSite: "strict", httpOnly: true },
      database: { generateId: () => uuidv7() },
    },
    rateLimit: { enabled: env.NODE_ENV !== "test", window: 60, max: 30 },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
