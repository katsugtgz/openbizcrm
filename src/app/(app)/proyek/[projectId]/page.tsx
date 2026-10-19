import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks as tasksTable, users as schemaUsers } from "@/db/schema";
import { session } from "@/lib/auth";
import { requireOrgRole } from "@/lib/org-scope";
import { getProject } from "@/lib/repos/project-repo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskBoard } from "./task-board";
import { GanttChart } from "./gantt";
import { DeleteProjectButton, ProjectStatusSelect } from "../project-dialogs";
import { NewTaskDialog, GenerateTodayButton } from "./task-dialogs";

export const metadata = { title: "Detail Proyek" };

const STATUS_BADGE: Record<string, string> = {
  planning: "bg-yellow-100 text-yellow-800",
  active: "bg-green-100 text-green-800",
  on_hold: "bg-orange-100 text-orange-800",
  done: "bg-blue-100 text-blue-800",
  cancelled: "bg-red-100 text-red-800",
};

async function TaskSection({
  orgId,
  userId,
  projectId,
}: {
  orgId: string;
  userId: string;
  projectId: string;
}) {
  await requireOrgRole(userId, orgId, "member");
  const rows = await db
    .select({ task: tasksTable, assigneeName: schemaUsers.name })
    .from(tasksTable)
    .leftJoin(schemaUsers, eq(tasksTable.assigneeId, schemaUsers.id))
    .where(eq(tasksTable.projectId, projectId))
    .orderBy(asc(tasksTable.position));
  const tasks = rows.map((r) => ({ ...r.task, assigneeName: r.assigneeName }));

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Kanban Task</CardTitle>
          <NewTaskDialog projectId={projectId} />
        </CardHeader>
        <CardContent>
          <TaskBoard projectId={projectId} tasks={tasks} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gantt</CardTitle>
        </CardHeader>
        <CardContent>
          <GanttChart
            tasks={tasks.map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              dueDate: t.dueDate,
              createdAt: t.createdAt.toISOString(),
            }))}
          />
        </CardContent>
      </Card>
    </>
  );
}

function TaskSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="flex gap-3 overflow-hidden">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="min-w-[200px] flex-1 space-y-2 rounded-lg bg-muted/50 p-2"
          >
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
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

  const project = await getProject(orgId, projectId);
  if (!project) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {project.name}
            </h1>
            <Badge className={STATUS_BADGE[project.status] ?? ""}>
              {project.code}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Kanban, gantt, dan timesheet proyek.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/proyek">Kembali</Link>
          </Button>
          <GenerateTodayButton projectId={project.id} />
          <ProjectStatusSelect projectId={project.id} status={project.status} />
          <DeleteProjectButton projectId={project.id} />
        </div>
      </div>

      <Suspense fallback={<TaskSkeleton />}>
        <TaskSection orgId={orgId} userId={user.id} projectId={projectId} />
      </Suspense>
    </div>
  );
}
