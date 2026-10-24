import { createDb } from "../client.js";
import { seedDemo } from "../seed-demo.js";
import { requireEnv } from "./env.js";

if (process.env.NODE_ENV === "production") {
  console.error("db:seed:demo is disabled in production.");
  process.exit(1);
}

const handle = createDb(requireEnv("DATABASE_OWNER_URL"), { max: 1 });
try {
  const result = await seedDemo(handle.db);
  console.log(
    result.skipped
      ? `Demo data already present (${result.customers} customers) — nothing changed.`
      : "Demo data added: catalogue grid, 8 suppliers, 3 transporters, 5 salesmen, 40 customers.",
  );
} finally {
  await handle.close();
}
