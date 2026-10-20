/**
 * Route-layer guards shared by API routes: UUID pre-validation, fixed-window
 * rate limit, same-origin CSRF check, per-conversation AI turn lock, gateway
 * TLS check, and domain-error mapping.
 *
 * Limiter/lock state is in-memory per instance: it bounds abuse on a single
 * server but is not a distributed throttle — document, do not rely on it
 * across replicas.
 */
import { NotFoundError, OrgScopeError } from "@/lib/org-scope";
import { PayrollError } from "@/lib/payroll/service";

/** Canonical UUID shape as accepted by PG uuid columns (any hex version). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// ---- fixed-window in-memory rate limiter ----

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function purgeExpiredBuckets(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): { ok: boolean; retryAfterSec: number } {
  if (buckets.size > 5000) purgeExpiredBuckets(now);
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { ok: true, retryAfterSec: 0 };
}

/** Test-only: reset limiter state. */
export function __resetRateLimits(): void {
  buckets.clear();
}

// ---- same-origin CSRF check for cookie-authed routes ----

/**
 * When the browser sends Origin or Referer it must match the request origin;
 * mismatches are cross-site forgery attempts. Requests with neither header
 * (curl, server-to-server) pass — browsers always attach Origin on
 * cross-site POSTs, which is the attack this blocks.
 */
export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  if (!origin && !referer) return true;
  let expected: string;
  try {
    expected = new URL(request.url).origin;
  } catch {
    return false;
  }
  for (const value of [origin, referer]) {
    if (!value) continue;
    let actual: string;
    try {
      actual = new URL(value).origin;
    } catch {
      return false;
    }
    if (actual !== expected) return false;
  }
  return true;
}

// ---- per-conversation AI turn lock ----

const inFlightTurns = new Set<string>();

/** Reserve a turn; false means another turn is already running. */
export function tryBeginTurn(conversationId: string): boolean {
  if (inFlightTurns.has(conversationId)) return false;
  inFlightTurns.add(conversationId);
  return true;
}

export function endTurn(conversationId: string): void {
  inFlightTurns.delete(conversationId);
}

// ---- AI gateway TLS check ----

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** True when the gateway URL would ship org data over plaintext non-loopback. */
export function isInsecureGatewayUrl(baseURL: string): boolean {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    return true;
  }
  if (url.protocol === "https:") return false;
  if (url.protocol !== "http:") return true;
  return !LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

// ---- domain-error mapping (no raw internals to clients) ----

/**
 * Map known domain throws to status responses; null when unknown (caller
 * logs and returns a generic 500). PayrollError/NotFoundError messages are
 * static Indonesian strings — safe to reflect.
 */
export function toDomainErrorResponse(e: unknown): Response | null {
  if (e instanceof OrgScopeError) {
    return Response.json({ error: "Akses ditolak." }, { status: 403 });
  }
  if (e instanceof NotFoundError) {
    return Response.json({ error: e.message }, { status: 404 });
  }
  if (e instanceof PayrollError) {
    if (e.code === "NOT_FOUND") {
      return new Response("Run tidak ditemukan.", { status: 404 });
    }
    return new Response(e.message, { status: 400 });
  }
  return null;
}
