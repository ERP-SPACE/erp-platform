import { createDb } from "../client.js";
import { seed } from "../seed.js";
import { requireEnv } from "./env.js";

const handle = createDb(requireEnv("DATABASE_OWNER_URL"), { max: 1 });
try {
  const result = await seed(handle.db, {
    owner: {
      email: requireEnv("SEED_OWNER_EMAIL"),
      name: process.env.SEED_OWNER_NAME ?? "Owner",
      password: requireEnv("SEED_OWNER_PASSWORD"),
    },
  });
  console.log(`Seeded company ${result.companyId}; Owner login: ${process.env.SEED_OWNER_EMAIL}`);
  console.log("The Owner password is SEED_OWNER_PASSWORD in .env.");
} finally {
  await handle.close();
}
