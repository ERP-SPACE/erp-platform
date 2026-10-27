import { createDb } from "../client.js";
import { seedDemo, seedDemoUser } from "../seed-demo.js";
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
  const email = process.env.DEMO_USER_EMAIL;
  const password = process.env.DEMO_USER_PASSWORD;
  if (email && password) {
    const user = await seedDemoUser(handle.db, { email, password });
    console.log(
      user.created
        ? `Demo sign-in created: ${email} (password is DEMO_USER_PASSWORD in .env).`
        : `Demo sign-in ${email} already exists.`,
    );
  }
} finally {
  await handle.close();
}
