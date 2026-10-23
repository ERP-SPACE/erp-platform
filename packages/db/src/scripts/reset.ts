import { createDb } from "../client.js";
import { dropAll, runMigrations } from "../migrate.js";
import { seed } from "../seed.js";
import { requireEnv } from "./env.js";

if (process.env.NODE_ENV === "production") {
  console.error("db:reset is disabled in production.");
  process.exit(1);
}

const ownerUrl = requireEnv("DATABASE_OWNER_URL");
await dropAll(ownerUrl);
await runMigrations(ownerUrl);
const handle = createDb(ownerUrl, { max: 1 });
try {
  await seed(handle.db, {
    owner: {
      email: requireEnv("SEED_OWNER_EMAIL"),
      name: process.env.SEED_OWNER_NAME ?? "Owner",
      password: requireEnv("SEED_OWNER_PASSWORD"),
    },
  });
} finally {
  await handle.close();
}
console.log("Database reset, migrated and seeded.");
