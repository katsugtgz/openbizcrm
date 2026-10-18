import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users as schemaUsers } from "@/db/schema";
import { session } from "@/lib/auth";
import { getEmployee } from "@/lib/repos/hrm-repo";
import { requireOrgRole } from "@/lib/org-scope";
import { updateEmployeeAction } from "../../actions";
import { EmployeeForm } from "../../employee-form";
import { Button } from "@/components/ui/button";

export default async function KaryawanEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const user = await session.getSession();
  if (!user) redirect("/login");
  const orgId =
    user.organizationId ??
    (
      await db
        .select({ orgId: schemaUsers.currentOrgId })
        .from(schemaUsers)
        .where(eq(schemaUsers.id, user.id))
        .limit(1)
    )[0]?.orgId;
  if (!orgId) redirect("/dashboard");
  await requireOrgRole(user.id, orgId, "admin");
  const employee = await getEmployee(orgId, id);
  if (!employee) notFound();
  const sp = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Edit: {employee.name}
        </h1>
        <Button asChild variant="outline" size="sm">
          <Link href="/karyawan">Kembali</Link>
        </Button>
      </div>
      {sp.error && (
        <p role="alert" className="text-sm text-destructive">
          {sp.error}
        </p>
      )}
      <EmployeeForm employee={employee} action={updateEmployeeAction} />
    </div>
  );
}
