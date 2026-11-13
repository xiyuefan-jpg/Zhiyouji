/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API runs on :3000 in development. In production the console is static files (OSS + CDN)
// and calls the API with VITE_API_BASE and a Bearer token (PRD part 2 §4.11).
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: { "/v1": "http://localhost:3000" } },
  build: { target: "es2019", sourcemap: false },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    // the tests start the real server (PGlite) and render full pages
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
