// Creates .env from .env.example and fills local secrets. Safe to re-run: existing values are kept.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = join(root, ".env.example");
const envPath = join(root, ".env");

const parse = (text) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );

const existing = existsSync(envPath) ? parse(readFileSync(envPath, "utf8")) : {};
const generated = {
  AUTH_SECRET: randomBytes(32).toString("base64url"),
  SEED_OWNER_PASSWORD: `${randomBytes(9).toString("base64url")}-Aa1`,
};

const output = readFileSync(examplePath, "utf8")
  .split(/\r?\n/)
  .map((line) => {
    if (!line || line.startsWith("#") || !line.includes("=")) return line;
    const key = line.slice(0, line.indexOf("="));
    const value = existing[key] || line.slice(line.indexOf("=") + 1) || generated[key] || "";
    return `${key}=${value}`;
  })
  .join("\n");

writeFileSync(envPath, output);
console.log(`.env ${Object.keys(existing).length ? "updated" : "created"} at ${envPath}`);
console.log("The seed Owner password is stored in .env (SEED_OWNER_PASSWORD).");
