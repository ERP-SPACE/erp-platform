/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API in development: cookies stay first-party and SameSite=Strict works.
    proxy: { "/api": { target: apiTarget, changeOrigin: false } },
  },
  preview: { port: 5173, proxy: { "/api": { target: apiTarget, changeOrigin: false } } },
  test: { environment: "jsdom", include: ["src/**/*.test.ts?(x)"] },
});
