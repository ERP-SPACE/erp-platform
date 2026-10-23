// Creates erp_owner / erp_app on a database not made by Docker Compose (CI service containers).
import { bootstrapRoles } from "../bootstrap.js";
import { requireEnv } from "./env.js";

await bootstrapRoles(requireEnv("DATABASE_SUPERUSER_URL"));
console.log("Database roles ready.");
