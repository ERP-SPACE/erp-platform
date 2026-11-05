/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { type ProxyOptions, defineConfig } from "vite";

const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";

/**
 * While the API is still starting (or stopped), answer 503 API_UNAVAILABLE with a readable
 * message instead of Vite's empty 500, so the app waits and retries rather than showing an error.
 */
const apiProxy: ProxyOptions = {
  target: apiTarget,
  changeOrigin: false,
  configure(proxy) {
    proxy.on("error", (_err, _req, res) => {
      if (!("writeHead" in res) || res.headersSent) return;
      res.writeHead(503, { "content-type": "application/problem+json", "retry-after": "2" });
      res.end(
        JSON.stringify({
          type: "about:blank",
          title: "The ERP server isn't running yet. It may still be starting — wait a few seconds.",
          status: 503,
          code: "API_UNAVAILABLE",
        }),
      );
    });
  },
};

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API in development: cookies stay first-party and SameSite=Strict works.
    proxy: { "/api": apiProxy },
  },
  preview: { port: 5173, proxy: { "/api": apiProxy } },
  test: { environment: "jsdom", include: ["src/**/*.test.ts?(x)"] },
});
