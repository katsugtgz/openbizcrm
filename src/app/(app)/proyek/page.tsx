import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users as schemaUsers } from "@/db/schema";
import { session } from "@/lib/auth";
import { requireOrgRole } from "@/lib/org-scope";
import { listProjects } from "@/lib/repos/project-repo";
import { listCompanies } from "@/lib/repos/crm-repo";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NewProjectDialog, ProjectStatusSelect } from "./project-dialogs";

export const metadata = { title: "Proyek" };

const STATUS_BADGE: Record<string, string> = {
  planning: "bg-yellow-100 text-yellow-800",
  active: "bg-green-100 text-green-800",
  on_hold: "bg-orange-100 text-orange-800",
  done: "bg-blue-100 text-blue-800",
  cancelled: "bg-red-100 text-red-800",
};

async function ProjectTable({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}) {
  await requireOrgRole(userId, orgId, "member");
  const [projects, companies] = await Promise.all([
    listProjects(orgId),
    listCompanies(orgId),
  ]);
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daftar Proyek</CardTitle>
      </CardHeader>
      <CardContent>
        {projects.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Belum ada proyek.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Klien</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="tabular-nums">{p.code}</TableCell>
                  <TableCell className="font-medium">
                    <Link className="hover:underline" href={`/proyek/${p.id}`}>
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {p.clientCompanyId
                      ? (companyName.get(p.clientCompanyId) ?? "-")
                      : "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge className={STATUS_BADGE[p.status] ?? ""}>
                        {p.status}
                      </Badge>
                      <ProjectStatusSelect projectId={p.id} status={p.status} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

export default async function ProyekPage() {
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Proyek</h1>
          <p className="text-sm text-muted-foreground">
            Kelola proyek, kanban task, gantt, dan timesheet.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/proyek/timesheet"
            className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent"
          >
            Timesheet Saya
          </Link>
          <Suspense fallback={null}>
            <CompaniesGate orgId={orgId} />
          </Suspense>
        </div>
      </div>
      <Suspense fallback={<TableSkeleton />}>
        <ProjectTable orgId={orgId} userId={user.id} />
      </Suspense>
    </div>
  );
}

async function CompaniesGate({ orgId }: { orgId: string }) {
  const companies = await listCompanies(orgId);
  return (
    <NewProjectDialog
      companies={companies.map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}
