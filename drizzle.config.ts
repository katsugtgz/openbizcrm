import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Keep migration 0029's forensic archive out of push management (cubic
  // pr10 r4): audit_logs_quarantine is intentionally absent from the
  // schema, so without this exclusion a later `db:push` could offer to
  // drop it and destroy the archived audit rows.
  tablesFilter: ["*", "!audit_logs_quarantine"],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
