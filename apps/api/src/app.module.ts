import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { ZodValidationPipe } from "nestjs-zod";
import { AuthModule } from "./auth/auth.module.js";
import { IdempotencyInterceptor } from "./common/idempotency.interceptor.js";
import { ProblemFilter } from "./common/problem.filter.js";
import { RequestContextMiddleware } from "./common/request-context.middleware.js";
import { ENV, type Env } from "./config/env.js";
import { DbModule } from "./db/db.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { HealthController } from "./modules/health/health.controller.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { RealtimeModule } from "./modules/realtime/realtime.module.js";
import { SeriesModule } from "./modules/series/series.module.js";
import { SettingsModule } from "./modules/settings/settings.module.js";
import { RedisModule } from "./redis/redis.module.js";

@Module({})
class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}

@Module({})
export class AppModule implements NestModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            transport:
              env.NODE_ENV === "development"
                ? { target: "pino-pretty", options: { singleLine: true } }
                : undefined,
            redact: [
              "req.headers.cookie",
              "req.headers.authorization",
              'res.headers["set-cookie"]',
            ],
            customProps: (req) => ({ requestId: (req as { id?: string }).id }),
            autoLogging: { ignore: (req) => req.url === "/api/healthz" },
          },
        }),
        DbModule,
        RedisModule,
        AuthModule,
        RealtimeModule,
        IdentityModule,
        SettingsModule,
        SeriesModule,
        AuditModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: ProblemFilter },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes("*path");
  }
}
