import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    // AUTH_FAKE=1 selects the in-memory session adapter (no WorkOS, no
    // "server-only"/next-headers graph) when tests import server modules.
    env: { AUTH_FAKE: "1" },
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "coverage/**", "vitest.config.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        "node_modules/**",
        ".next/**",
        "coverage/**",
        "src/test/setup.ts",
        "src/**/*.test.{ts,tsx}",
        "vitest.config.ts",
        // Vendor-generated shadcn/ui components — covered via e2e.
        "src/components/ui/**",
        // Next.js app scaffolding (layout/pages) — covered via e2e.
        "src/app/**",
        // Drizzle schema is declarative; db client needs a live DATABASE_URL.
        "src/db/**",
      ],
      // Skeleton baseline — raise as real feature coverage lands.
      thresholds: {
        lines: 60,
        branches: 60,
        functions: 60,
        statements: 60,
      },
    },
  },
});
