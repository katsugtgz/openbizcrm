import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { reviewAssignments, reviewPeriods } from "@/db/schema";

/**
 * Throttle in-memory untuk endpoint publik (bughunt batch1 app:16/17).
 * Fixed-window per kunci; cukup untuk deployment single-instance.
 * Catatan: kunci per input rute (slug/token), bukan per IP — rotasi slug
 * masih lolos, tapi tiap slug hanya query DB murah + 404.
 */
const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 10_000;

/** true = boleh lanjut; false = over limit (jangan hit DB). */
export function checkThrottle(
  key: string,
  limit: number,
  windowMs = 60_000,
): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  let hits = buckets.get(key);
  if (!hits) {
    hits = [];
    buckets.set(key, hits);
  }
  let i = 0;
  while (i < hits.length && hits[i] <= cutoff) i++;
  if (i > 0) hits.splice(0, i);
  if (hits.length >= limit) return false;
  hits.push(now);
  if (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next();
    if (!oldest.done) buckets.delete(oldest.value);
  }
  return true;
}

/**
 * Best-effort requester identity for public throttling: the first
 * x-forwarded-for entry (or x-real-ip when absent).
 *
 * DEPLOYMENT REQUIREMENT: these headers are only meaningful when the edge
 * proxy scrubs inbound X-Forwarded-For and appends the real client IP —
 * without a trusted proxy an attacker spoofs the IP and only the global
 * backstop holds. Null outside a request scope (tests) or when the
 * headers are absent: the requester layer is then skipped rather than
 * sharing one "unknown" bucket that could be saturated jointly.
 */
async function requesterIp(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim() || null;
    return h.get("x-real-ip")?.trim() || null;
  } catch {
    // Di luar scope request (tes/unit): tak ada identitas requester.
    return null;
  }
}

/**
 * Two-layer throttle for login-less public endpoints: a requester layer
 * (per IP per resource) plus a global backstop per resource. When the
 * requester IP is known both layers must pass; without an IP only the
 * backstop applies. Slug/link keys alone are not enough — an attacker
 * could rotate them to DoS public forms or flood the DB.
 */
export async function checkPublicThrottle(
  requesterBase: string,
  requesterLimit: number,
  globalBase: string,
  globalLimit: number,
  windowMs = 60_000,
): Promise<boolean> {
  const ip = await requesterIp();
  // Tanpa IP: hanya backstop global yang berlaku (tanpa bucket "unknown"
  // bersama yang bisa dijenuhkan lintas requester).
  const requesterOk = ip
    ? checkThrottle(`${ip}:${requesterBase}`, requesterLimit, windowMs)
    : true;
  return requesterOk && checkThrottle(globalBase, globalLimit, windowMs);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Token ?a= valid hanya jika assignment-nya terikat ke form+org yang sama
 * (assignment -> period -> form). UUID tak valid langsung false (tanpa
 * query, cegah PG 22P02). Dipakai /r/[slug] + /f/[slug] agar slug
 * tebak-tebakan (slugify judul) tidak membocorkan form lintas-org
 * (bughunt batch1 app:3).
 */
export async function verifyAssignmentToken(
  assignmentId: string,
  formId: string,
  orgId: string,
): Promise<boolean> {
  if (!UUID_RE.test(assignmentId)) return false;
  const [row] = await db
    .select({ id: reviewAssignments.id })
    .from(reviewAssignments)
    .innerJoin(
      reviewPeriods,
      and(
        eq(reviewPeriods.id, reviewAssignments.periodId),
        eq(reviewPeriods.orgId, reviewAssignments.orgId),
      ),
    )
    .where(
      and(
        eq(reviewAssignments.id, assignmentId),
        eq(reviewAssignments.orgId, orgId),
        eq(reviewPeriods.formId, formId),
      ),
    )
    .limit(1);
  return !!row;
}
