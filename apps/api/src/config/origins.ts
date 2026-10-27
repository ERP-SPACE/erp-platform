import type { Env } from "./env.js";

/** Browser origins allowed in dev (localhost vs 127.0.0.1 share cookies only within the same host). */
export function webOrigins(env: Env): string[] {
  if (env.NODE_ENV !== "development") return [env.WEB_ORIGIN];
  const primary = new URL(env.WEB_ORIGIN);
  const alternate = new URL(env.WEB_ORIGIN);
  if (primary.hostname === "localhost") alternate.hostname = "127.0.0.1";
  else if (primary.hostname === "127.0.0.1") alternate.hostname = "localhost";
  else return [env.WEB_ORIGIN];
  return alternate.origin === env.WEB_ORIGIN ? [env.WEB_ORIGIN] : [env.WEB_ORIGIN, alternate.origin];
}
