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
 * postgres-js must encrypt remote connections: without `ssl`, credentials
 * and PII travel in cleartext whenever DB_DRIVER=postgres points at a
 * non-local host (bughunt data-tenant). Local loopback stays plaintext.
 * An explicit `sslmode` in the URL always wins over this default.
 */
export function shouldRequireSsl(url: string): boolean {
  if (/[?&]sslmode=/i.test(url)) return false;
  try {
    // URL keeps IPv6 brackets in hostname ("[::1]").
    const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return !(
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
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

function createDb() {
  const databaseUrl = resolveDatabaseUrl();
  if (shouldUseNeon(databaseUrl)) {
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

  const client = postgres(databaseUrl, {
    max: 5,
    ...(shouldRequireSsl(databaseUrl) ? { ssl: "require" as const } : {}),
  });
  return drizzlePostgres(client, { schema });
}

type Db = ReturnType<typeof createDb>;

let realDb: Db | null = null;

function getRealDb(): Db {
  realDb ??= createDb();
  return realDb;
}

/**
 * Lazy db handle: resolves DATABASE_URL and connects on FIRST PROPERTY
 * ACCESS, never at import time — so `next build` can collect route/page
 * data in CI (no DATABASE_URL there) without throwing. The resolved
 * instance is cached (one pool per process).
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const real = getRealDb();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
  has(_target, prop) {
    return prop in (getRealDb() as object);
  },
});

export const dbDriver: "neon" | "postgres" = shouldUseNeon(
  process.env.DATABASE_URL ?? "",
)
  ? "neon"
  : "postgres";
export { schema };
