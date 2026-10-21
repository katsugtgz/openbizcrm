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
 * Identitas requester terbaik untuk throttle publik (cubic pr10 r:25,
 * penilaian:236): entri pertama x-forwarded-for (atau x-real-ip bila tak
 * ada). Bukan identitas tepercaya penuh — header bisa dipalsukan tanpa
 * proxy tepercaya — tapi menaikkan biaya serang dari "tahu slug" menjadi
 * "rotasi IP". Di luar scope request (tes): kunci global saja.
 */
async function requesterIp(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim() || "unknown";
    return h.get("x-real-ip")?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Throttle dua lapis untuk endpoint publik tanpa login: lapis requester
 * (per IP per resource) + backstop global per resource. Keduanya harus
 * lolos — kunci slug/tautan saja bisa diputar penyerang untuk DoS form
 * publik atau membanjiri DB.
 */
export async function checkPublicThrottle(
  requesterBase: string,
  requesterLimit: number,
  globalBase: string,
  globalLimit: number,
  windowMs = 60_000,
): Promise<boolean> {
  const ip = await requesterIp();
  return (
    checkThrottle(`${ip}:${requesterBase}`, requesterLimit, windowMs) &&
    checkThrottle(globalBase, globalLimit, windowMs)
  );
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
