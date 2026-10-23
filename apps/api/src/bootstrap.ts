import "reflect-metadata";
import type { IncomingMessage } from "node:http";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { uuidv7 } from "uuidv7";
import { AppModule } from "./app.module.js";
import { AUTH, type Auth } from "./auth/auth.factory.js";
import { registerAuthRoutes } from "./auth/auth.routes.js";
import type { Env } from "./config/env.js";

/** Builds the Nest application (used by main.ts, the OpenAPI exporter and integration tests). */
export async function createApp(env: Env, options: { logger?: boolean } = {}): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    genReqId: (req: IncomingMessage) => {
      const incoming = req.headers["x-request-id"];
      return typeof incoming === "string" && incoming.length <= 64 ? incoming : uuidv7();
    },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env), adapter, {
    bufferLogs: true,
    logger: options.logger === false ? false : undefined,
  });
  if (options.logger !== false) app.useLogger(app.get(Logger));

  app.setGlobalPrefix("api");
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    exposedHeaders: ["x-request-id", "idempotent-replay"],
  });
  app.enableShutdownHooks();

  await app.register(helmet, { contentSecurityPolicy: false }); // API serves JSON only
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  registerAuthRoutes(app.getHttpAdapter().getInstance(), app.get<Auth>(AUTH), env.API_PUBLIC_URL);
  return app;
}

export function buildOpenApi(app: NestFastifyApplication) {
  const config = new DocumentBuilder()
    .setTitle("Paper Trading ERP API")
    .setVersion("0.1.0")
    .addCookieAuth("erp.session_token")
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}
