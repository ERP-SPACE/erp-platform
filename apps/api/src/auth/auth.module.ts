import type { DbHandle } from "@erp/db";
import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ENV, type Env } from "../config/env.js";
import { DB } from "../db/tokens.js";
import { ActorService } from "./actor.service.js";
import { AUTH, createAuth } from "./auth.factory.js";
import { AuthGuard } from "./auth.guard.js";

@Global()
@Module({
  providers: [
    {
      provide: AUTH,
      inject: [ENV, DB],
      useFactory: (env: Env, db: DbHandle) => createAuth(env, db),
    },
    ActorService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AUTH, ActorService],
})
export class AuthModule {}
