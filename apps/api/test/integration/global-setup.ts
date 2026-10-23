import { bootstrapRoles, createDb, runMigrations, seed } from "@erp/db";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import type { TestProject } from "vitest/node";

export const OWNER = { email: "owner@test.local", name: "Test Owner", password: "Owner-Pass-12345" };

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    ownerDatabaseUrl: string;
    redisUrl: string;
    companyId: string;
    ownerUserId: string;
  }
}

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;

/** One Postgres 17 + Redis 7 pair for the whole integration run, migrated and seeded once. */
export async function setup(project: TestProject): Promise<void> {
  [postgres, redis] = await Promise.all([
    new PostgreSqlContainer("postgres:17-alpine").withDatabase("erp").start(),
    new RedisContainer("redis:7-alpine").start(),
  ]);
  const superuserUrl = postgres.getConnectionUri();
  await bootstrapRoles(superuserUrl);
  const base = new URL(superuserUrl);
  const asRole = (user: string, password: string) => {
    const url = new URL(base);
    url.username = user;
    url.password = password;
    return url.toString();
  };
  const ownerDatabaseUrl = asRole("erp_owner", "erp_owner_dev");
  await runMigrations(ownerDatabaseUrl);
  const handle = createDb(ownerDatabaseUrl, { max: 1 });
  const seeded = await seed(handle.db, { owner: OWNER });
  await handle.close();

  project.provide("databaseUrl", asRole("erp_app", "erp_app_dev"));
  project.provide("ownerDatabaseUrl", ownerDatabaseUrl);
  project.provide("redisUrl", redis.getConnectionUrl());
  project.provide("companyId", seeded.companyId);
  project.provide("ownerUserId", seeded.ownerUserId);
}

export async function teardown(): Promise<void> {
  await Promise.all([postgres?.stop(), redis?.stop()]);
}
