import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { getEmployee } from "@/lib/repos/hrm-repo";
import { formatIDR } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_LABEL: Record<string, string> = {
  active: "Aktif",
  resigned: "Resign",
  suspended: "Suspended",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dashed py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export default async function KaryawanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await session.getSession();
  if (!user) redirect("/login");
  // WorkOS session IDs -> internal UUIDs (cubic P1 karyawan-id:37).
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids;
  await requireOrgRole(userId, orgId, "member");
  const employee = await getEmployee(orgId, id);
  if (!employee) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {employee.name}
          </h1>
          <Badge
            className={
              employee.status === "active"
                ? "bg-green-100 text-green-800"
                : "bg-gray-100 text-gray-700"
            }
          >
            {STATUS_LABEL[employee.status] ?? employee.status}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/karyawan">Kembali</Link>
          </Button>
          <Button asChild size="sm">
            <Link href={`/karyawan/${employee.id}/edit`}>Edit</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Karyawan</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="No. Karyawan" value={employee.employeeNo} />
          <Row label="Status Pajak (TER)" value={employee.taxStatus} />
          <Row label="Gaji Pokok" value={formatIDR(employee.baseSalary)} />
          <Row label="Tanggal Masuk" value={employee.hireDate ?? "—"} />
          <Row
            label="Rekening"
            value={
              employee.bankName
                ? `${employee.bankName} ${employee.bankAccount ?? ""}`.trim()
                : "—"
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
