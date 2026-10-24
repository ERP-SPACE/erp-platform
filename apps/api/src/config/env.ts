import { z } from "zod";

/** Environment contract (ADR-0019 twelve-factor config). The API refuses to boot on bad config. */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_PUBLIC_URL: z.url(),
  WEB_ORIGIN: z.url(),
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters (run pnpm setup:local)"),
  STEP_UP_SECONDS: z.coerce.number().int().positive().default(300),
  REQUIRE_OWNER_TOTP: z.stringbool().default(true),
  /** ADR-0023: "local" writes under STORAGE_DIR; "s3" arrives with Stage 7. */
  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_DIR: z.string().min(1).default("../../.storage"),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;
export const ENV = Symbol("ENV");

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  return result.data;
}
