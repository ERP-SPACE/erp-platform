import { z } from "zod";

/** Environment contract (ADR-0019 twelve-factor config). The API refuses to boot on bad config. */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  /** BullMQ key prefix: keeps an isolated stack (e2e) off the dev queues on the same Redis. */
  QUEUE_PREFIX: z.string().min(1).default("bull"),
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
  /**
   * Run the API's own background consumers in this process: the IRN queue (ADR-0011) and the
   * credit re-check of held orders. Integration tests turn it off and drive them directly.
   */
  API_JOBS: z.stringbool().default(true),
  /**
   * Where document PDFs are made: "worker" sends the HTML to the worker's Chromium (default);
   * "inline" runs Chromium in the API process (tests, single-process setups).
   */
  PDF_RENDERER: z.enum(["worker", "inline"]).default("worker"),
  /**
   * NIC e-invoice sandbox (ADR-0011, Q27). Without credentials the SANDBOX provider runs a local
   * simulator that returns well-formed but unsigned IRNs, so dev and CI work offline.
   */
  NIC_BASE_URL: z.url().default("https://einv-apisandbox.nic.in"),
  NIC_CLIENT_ID: z.string().min(1).optional(),
  NIC_CLIENT_SECRET: z.string().min(1).optional(),
  NIC_USERNAME: z.string().min(1).optional(),
  NIC_PASSWORD: z.string().min(1).optional(),
  /** The GSTIN registered on the sandbox; it replaces the seller GSTIN on sandbox calls. */
  NIC_GSTIN: z.string().length(15).optional(),
  /** NIC's RSA public key: PEM, or the base64 DER published on the portal. */
  NIC_PUBLIC_KEY: z.string().min(1).optional(),
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
