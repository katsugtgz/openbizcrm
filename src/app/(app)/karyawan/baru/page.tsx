import Link from "next/link";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { listMembers } from "@/lib/repos/member-repo";
import { listLinkedUserIds } from "@/lib/repos/hrm-repo";
import { createEmployeeAction } from "../actions";
import { EmployeeForm } from "../employee-form";
import { Button } from "@/components/ui/button";

export default async function KaryawanBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await session.getSession();
  if (!user) redirect("/login");
  // WorkOS session IDs -> internal UUIDs (cubic P1).
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids;
  await requireOrgRole(userId, orgId, "admin");
  const sp = await searchParams;
  // Sembunyikan user yang sudah tertaut (cubic pr10 r2:2232): memilihnya
  // pasti gagal validasi — jangan tawarkan.
  const [linkedIds, allMembers] = await Promise.all([
    listLinkedUserIds(orgId),
    listMembers(userId, orgId),
  ]);
  const linked = new Set(linkedIds);
  const members = allMembers
    .filter((m) => !linked.has(m.user.id))
    .map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Karyawan Baru</h1>
        <Button asChild variant="outline" size="sm">
          <Link href="/karyawan">Kembali</Link>
        </Button>
      </div>
      {sp.error && (
        <p role="alert" className="text-sm text-destructive">
          {sp.error}
        </p>
      )}
      <EmployeeForm members={members} action={createEmployeeAction} />
    </div>
  );
}
