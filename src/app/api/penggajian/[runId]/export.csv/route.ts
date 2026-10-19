import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { exportBankTransfer } from "@/lib/payroll/service";

/** CSV transfer bank untuk satu payroll run (CSV text/plain download). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const user = await session.getSession();
  if (!user) redirect("/login");
  // WorkOS session IDs -> internal UUIDs; unresolvable user/org = akses
  // ditolak (403), bukan server error.
  const ids = await resolveSessionIds(user);
  if (!ids) {
    return new Response("Akses ditolak.", { status: 403 });
  }
  const { userId, orgId } = ids;

  const csv = await exportBankTransfer(userId, orgId, runId);
  const filename = `transfer-bank-${runId.slice(0, 8)}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
