import { defineConfig } from "vitest/config";

// Tests start an in-process PostgreSQL (PGlite) or run whole seasons; GitHub's
// machines are about twice as slow as local ones, so the default 5 s is too tight.
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 60_000 },
});
