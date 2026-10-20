import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import {
  listCompletions,
  listCourses,
  listMaterials,
} from "@/lib/review/service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AddMaterialButton, NewCourseDialog } from "./course-dialog";
import { CompleteCourseButton } from "./course-controls";

export const metadata = { title: "Pelatihan" };

export default async function PelatihanPage() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/");
  await requireOrgRole(ids.userId, ids.orgId, "member");
  const [courses, completions] = await Promise.all([
    listCourses(ids.orgId),
    listCompletions(ids.orgId, ids.userId),
  ]);
  const doneIds = new Set(completions.map((c) => c.courseId));
  // Materi per kursus (cubic pelatihan/page.tsx:53): tanpa ini materi yang
  // dibuat saat pembuatan kursus tidak pernah terlihat pembelajar.
  const materialsByCourse = new Map(
    await Promise.all(
      courses.map(
        async (c) => [c.id, await listMaterials(ids.orgId, c.id)] as const,
      ),
    ),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Pelatihan</h1>
          <p className="text-sm text-muted-foreground">
            Kursus internal dan penyelesaian belajar.
          </p>
        </div>
        <NewCourseDialog />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {courses.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada kursus.</p>
        )}
        {courses.map((c) => (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle className="text-base">{c.title}</CardTitle>
              {c.description && (
                <CardDescription>{c.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {(materialsByCourse.get(c.id) ?? []).map((m) => (
                <details key={m.id} className="rounded-md border px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium">
                    {m.title}
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {m.content}
                  </p>
                </details>
              ))}
              {doneIds.has(c.id) ? (
                <p className="text-xs text-green-700">Selesai ✓</p>
              ) : (
                <CompleteCourseButton courseId={c.id} />
              )}
              <AddMaterialButton courseId={c.id} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
