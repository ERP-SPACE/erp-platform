import { createDb } from "../client.js";
import { seedDemoTransactions } from "../seed-demo-transactions.js";
import { requireEnv } from "./env.js";

if (process.env.NODE_ENV === "production") {
  console.error("db:seed:demo:txn is disabled in production.");
  process.exit(1);
}

const handle = createDb(requireEnv("DATABASE_OWNER_URL"), { max: 1 });
try {
  const result = await seedDemoTransactions(handle.db);
  console.log(
    result.skipped
      ? `Demo transactions already present (${result.rolls} rolls) — nothing changed.`
      : `Demo transactions added: ${result.rolls} rolls, ${result.orders} sales orders, with DCs, invoices and receipts.`,
  );
} finally {
  await handle.close();
}
