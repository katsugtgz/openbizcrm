import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { listCompletions, listCourses } from "@/lib/review/service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CompleteCourseButton } from "@/app/(app)/pelatihan/course-controls";

export const metadata = { title: "LMS" };

/** Alias LMS /lms -> konten pelatihan (kursus + penyelesaian belajar). */
export default async function LmsPage() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  await requireOrgRole(ids.userId, ids.orgId, "member");
  const [courses, completions] = await Promise.all([
    listCourses(ids.orgId),
    listCompletions(ids.orgId, ids.userId),
  ]);
  const doneIds = new Set(completions.map((c) => c.courseId));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">LMS</h1>
        <p className="text-sm text-muted-foreground">
          Kursus pelatihan internal.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {courses.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Belum ada kursus. Buat di halaman Pelatihan.
          </p>
        )}
        {courses.map((c) => (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle className="text-base">{c.title}</CardTitle>
              {c.description && (
                <CardDescription>{c.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {doneIds.has(c.id) ? (
                <p className="text-xs text-green-700">Selesai ✓</p>
              ) : (
                <CompleteCourseButton courseId={c.id} />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
