import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "./auth.factory.js";

/**
 * Mounts Better Auth's fetch handler at /api/auth/* on the underlying Fastify instance
 * (Better Auth's documented Fastify integration). Sign-in is additionally rate limited.
 */
export function registerAuthRoutes(fastify: FastifyInstance, auth: Auth, publicUrl: string): void {
  fastify.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    async handler(request: FastifyRequest, reply: FastifyReply) {
      const url = new URL(request.url, publicUrl);
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
        if (key !== "set-cookie") void reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) void reply.header("set-cookie", cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
