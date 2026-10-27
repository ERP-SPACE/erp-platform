import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "./auth.factory.js";

/** Origin Better Auth should see (browser / Vite proxy), not the internal API listen URL. */
function authRequestOrigin(request: FastifyRequest, webOrigin: string): string {
  const origin = request.headers.origin;
  if (typeof origin === "string" && /^https?:\/\//.test(origin)) return origin;
  const host = request.headers.host;
  if (typeof host === "string" && host.length > 0) {
    const proto =
      (typeof request.headers["x-forwarded-proto"] === "string"
        ? request.headers["x-forwarded-proto"]
        : "http"
      ).split(",")[0] ?? "http";
    return `${proto}://${host}`;
  }
  return webOrigin;
}

/**
 * Mounts Better Auth's fetch handler at /api/auth/* on the underlying Fastify instance
 * (Better Auth's documented Fastify integration). Sign-in is additionally rate limited.
 */
export function registerAuthRoutes(fastify: FastifyInstance, auth: Auth, webOrigin: string): void {
  fastify.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    async handler(request: FastifyRequest, reply: FastifyReply) {
      const url = new URL(request.url, authRequestOrigin(request, webOrigin));
      const hasBody =
        request.method !== "GET" && request.body !== undefined && request.body !== null;
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          body: hasBody ? JSON.stringify(request.body) : undefined,
        }),
      );

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") return;
        void reply.header(key, value);
      });
      // Each Set-Cookie must be its own header (comma-joining breaks 2FA + session cookies).
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.raw.setHeader("set-cookie", cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
