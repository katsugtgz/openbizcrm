import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { exportBankTransfer } from "@/lib/payroll/service";
import {
  checkRateLimit,
  isUuid,
  toDomainErrorResponse,
} from "@/app/api/_lib/guards";

/** Throttle ekspor CSV sensitif: 30 permintaan/menit per user. */
const EXPORT_RATE_LIMIT = 30;
const EXPORT_RATE_WINDOW_MS = 60_000;

/** CSV transfer bank untuk satu payroll run (CSV text/plain download). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const user = await session.getSession();
  if (!user) {
    return Response.redirect(new URL("/login", request.url), 302);
  }
  // WorkOS session IDs -> internal UUIDs; unresolvable user/org = akses
  // ditolak (403), bukan server error.
  const ids = await resolveSessionIds(user);
  if (!ids) {
    return new Response("Akses ditolak.", { status: 403 });
  }
  const { userId, orgId } = ids;

  // UUID dicek dulu: nilai liar jadi 400 (dan filename aman hex), bukan
  // 500 dari cast uuid PG.
  if (!isUuid(runId)) {
    return new Response("ID run tidak valid.", { status: 400 });
  }

  const throttle = checkRateLimit(
    `payroll-export:${userId}`,
    EXPORT_RATE_LIMIT,
    EXPORT_RATE_WINDOW_MS,
  );
  if (!throttle.ok) {
    return new Response("Terlalu banyak permintaan. Coba lagi.", {
      status: 429,
      headers: { "Retry-After": String(throttle.retryAfterSec) },
    });
  }

  try {
    await requireOrgRole(userId, orgId, "admin");
    const csv = await exportBankTransfer(userId, orgId, runId);
    const filename = `transfer-bank-${runId.slice(0, 8)}.csv`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, private",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const mapped = toDomainErrorResponse(e);
    if (mapped) return mapped;
    console.error("Payroll export error:", e);
    return new Response("Terjadi kesalahan server.", { status: 500 });
  }
}
