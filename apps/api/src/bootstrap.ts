import "reflect-metadata";
import type { IncomingMessage } from "node:http";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
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
import { applyZodSchemas } from "./common/dto.js";
import type { Env } from "./config/env.js";
import { webOrigins } from "./config/origins.js";

/** Builds the Nest application (used by main.ts, the OpenAPI exporter and integration tests). */
export async function createApp(
  env: Env,
  options: { logger?: boolean } = {},
): Promise<NestFastifyApplication> {
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
    origin: webOrigins(env),
    credentials: true,
    exposedHeaders: ["x-request-id", "idempotent-replay"],
  });
  app.enableShutdownHooks();

  await app.register(helmet, { contentSecurityPolicy: false }); // API serves JSON only
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  // File uploads (ADR-0023): one file per request, size capped; type is checked by magic bytes.
  await app.register(multipart, {
    limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1, fields: 5, fieldSize: 1000 },
  });
  registerAuthRoutes(app.getHttpAdapter().getInstance(), app.get<Auth>(AUTH), env.WEB_ORIGIN);
  return app;
}

export function buildOpenApi(app: NestFastifyApplication) {
  // OpenAPI 3.1 so nullable fields are emitted as `anyOf: [T, null]`, which openapi-typescript reads as `T | null`.
  const config = new DocumentBuilder()
    .setOpenAPIVersion("3.1.0")
    .setTitle("Paper Trading ERP API")
    .setVersion("0.1.0")
    .addCookieAuth("erp.session_token")
    .build();
  return applyZodSchemas(
    cleanupOpenApiDoc(SwaggerModule.createDocument(app, config), { version: "3.1" }),
  );
}
