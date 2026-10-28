import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { inject } from "vitest";
import { createApp } from "../../src/bootstrap.js";
import { type Env, loadEnv } from "../../src/config/env.js";
import { OWNER } from "./global-setup.js";

export { OWNER };

export interface TestApp {
  app: NestFastifyApplication;
  fastify: FastifyInstance;
  env: Env;
  close(): Promise<void>;
}

export async function startApp(
  overrides: Partial<Record<keyof Env, string>> = {},
): Promise<TestApp> {
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: inject("databaseUrl"),
    REDIS_URL: inject("redisUrl"),
    API_JOBS: "false",
    PDF_RENDERER: "inline",
    API_PUBLIC_URL: "http://localhost:3000",
    WEB_ORIGIN: "http://localhost:5173",
    AUTH_SECRET: "integration-test-secret-that-is-long-enough-000",
    REQUIRE_OWNER_TOTP: "false",
    LOG_LEVEL: "silent",
    ...overrides,
  });
  const app = await createApp(env, { logger: false });
  await app.init();
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();
  return { app, fastify, env, close: () => app.close() };
}

/** A signed-in HTTP client carrying the session cookie. */
export class Client {
  constructor(
    private readonly fastify: FastifyInstance,
    readonly cookie: string,
  ) {}

  static async signIn(
    fastify: FastifyInstance,
    email = OWNER.email,
    password = OWNER.password,
  ): Promise<Client> {
    const res = await fastify.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: "http://localhost:5173" },
      payload: { email, password },
    });
    if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`);
    const setCookie = [res.headers["set-cookie"]].flat().filter(Boolean) as string[];
    const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
    return new Client(fastify, cookie);
  }

  request(
    options: InjectOptions & { reason?: string; idempotencyKey?: string },
  ): Promise<LightMyRequestResponse> {
    const { reason, idempotencyKey, headers, ...rest } = options;
    return this.fastify.inject({
      ...rest,
      headers: {
        cookie: this.cookie,
        origin: "http://localhost:5173",
        ...(reason && { "x-change-reason": encodeURIComponent(reason) }),
        ...(idempotencyKey && { "idempotency-key": idempotencyKey }),
        ...headers,
      },
    });
  }

  get(url: string) {
    return this.request({ method: "GET", url });
  }
}

export function json<T = Record<string, unknown>>(res: LightMyRequestResponse): T {
  return JSON.parse(res.body) as T;
}
