import { createDb, type DbHandle } from "@erp/db";
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { DB } from "./tokens.js";
import { UnitOfWork } from "./unit-of-work.js";

export { DB };

@Injectable()
class DbLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}
  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env) => createDb(env.DATABASE_URL, { max: 10 }),
    },
    DbLifecycle,
    UnitOfWork,
  ],
  exports: [DB, UnitOfWork],
})
export class DbModule {}
