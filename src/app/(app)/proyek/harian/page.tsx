import { Suspense } from "react";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { taskTemplates } from "@/db/schema";
import { resolveSessionIds } from "@/lib/auth/ids";
import { session } from "@/lib/auth";
import { requireOrgRole } from "@/lib/org-scope";
import { listProjects } from "@/lib/repos/project-repo";
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
import {
  DeleteTemplateButton,
  GenerateTodayButton,
  TemplateForm,
} from "../[projectId]/task-dialogs";

export const metadata = { title: "Tugas Harian" };

const PRIORITY_BADGE: Record<string, string> = {
  low: "bg-gray-100 text-gray-700",
  medium: "bg-blue-100 text-blue-800",
  high: "bg-orange-100 text-orange-800",
  urgent: "bg-red-100 text-red-800",
};

const PRIORITY_LABEL: Record<string, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
  urgent: "Urgent",
};

async function TemplateSection({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}) {
  await requireOrgRole(userId, orgId, "admin");
  const [templates, projects] = await Promise.all([
    db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.orgId, orgId))
      .orderBy(asc(taskTemplates.name)),
    listProjects(orgId),
  ]);
  const projectOptions = projects.map((p) => ({
    id: p.id,
    name: `${p.code} — ${p.name}`,
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Generate Tugas Hari Ini</CardTitle>
          <GenerateTodayButton projects={projectOptions} compact />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Buat task hari ini dari semua template ke proyek pilihan. Template
            yang sudah dibuat hari ini dilewati otomatis.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Template Tugas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TemplateForm />
          {templates.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Belum ada template.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Prioritas</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>
                      <Badge className={PRIORITY_BADGE[t.priority] ?? ""}>
                        {PRIORITY_LABEL[t.priority] ?? t.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DeleteTemplateButton templateId={t.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-44" />
      </CardHeader>
      <CardContent className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

export default async function TugasHarianPage() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  // WorkOS session IDs -> internal UUIDs (cubic P1 harian:139). Guard runs
  // at the page boundary, not inside the streamed child (cubic P2 harian:49).
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids!;
  await requireOrgRole(userId, orgId, "admin");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tugas Harian</h1>
        <p className="text-sm text-muted-foreground">
          Template tugas rutin dan generate task harian.
        </p>
      </div>
      <Suspense fallback={<SectionSkeleton />}>
        <TemplateSection orgId={orgId} userId={userId} />
      </Suspense>
    </div>
  );
}
