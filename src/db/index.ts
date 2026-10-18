import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";

import * as schema from "./schema";

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Set it in .env.local (local Postgres) or your Neon connection string.",
    );
  }
  return url;
}

/**
 * Local dev uses postgres-js against a plain Postgres (Docker / localhost).
 * Prod uses the Neon serverless driver. DB_DRIVER=postgres forces the local
 * driver regardless of the URL host.
 */
function shouldUseNeon(url: string): boolean {
  if (process.env.DB_DRIVER === "postgres") return false;
  if (process.env.DB_DRIVER === "neon") return true;
  try {
    const { hostname } = new URL(url);
    return !(
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

const databaseUrl = resolveDatabaseUrl();
const useNeon = shouldUseNeon(databaseUrl);

function createDb() {
  if (useNeon) {
    // On Node (non-edge), the Neon driver needs a WebSocket constructor.
    // Node 22 ships a stable global WebSocket, so no `ws` dependency needed.
    if (!neonConfig.webSocketConstructor && !globalThis.WebSocket) {
      throw new Error(
        "Neon serverless driver requires a WebSocket constructor. Install `ws` and set neonConfig.webSocketConstructor, or run on Node >= 22.",
      );
    }
    if (!neonConfig.webSocketConstructor) {
      neonConfig.webSocketConstructor =
        globalThis.WebSocket as unknown as typeof neonConfig.webSocketConstructor;
    }
    const pool = new NeonPool({ connectionString: databaseUrl });
    return drizzleNeon(pool, { schema });
  }

  const client = postgres(databaseUrl);
  return drizzlePostgres(client, { schema });
}

export const db = createDb();
export const dbDriver: "neon" | "postgres" = useNeon ? "neon" : "postgres";
export { schema };
