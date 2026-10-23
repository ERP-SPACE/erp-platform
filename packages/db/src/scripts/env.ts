export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Run \`pnpm setup:local\` at the repo root first.`);
    process.exit(1);
  }
  return value;
}
