import { Suspense } from "react";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { listMembers } from "@/lib/repos/member-repo";
import {
  listForms,
  listMyAssignments,
  listPeriods,
} from "@/lib/review/service";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { NewFormDialog, NewPeriodDialog } from "./new-form-dialog";
import { AggregateSection } from "./aggregate-section";
import { AssignReviewersDialog } from "./assign-reviewers-dialog";
import {
  PeriodActions,
  ReviewFormActions,
  SubmitReviewForm,
} from "./review-controls";

export const metadata = { title: "Penilaian 360" };

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Aktif",
  closed: "Ditutup",
  open: "Berjalan",
};

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active" || status === "open"
      ? "bg-green-100 text-green-800"
      : status === "closed"
        ? "bg-gray-200 text-gray-700"
        : "bg-yellow-100 text-yellow-800";
  return <Badge className={tone}>{STATUS_LABEL[status] ?? status}</Badge>;
}

async function FormsSection({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}) {
  await requireOrgRole(userId, orgId, "member");
  const forms = await listForms(orgId);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Form Penilaian</CardTitle>
          <CardDescription>Definisi pertanyaan review 360.</CardDescription>
        </div>
        <NewFormDialog />
      </CardHeader>
      <CardContent className="space-y-3">
        {forms.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada form.</p>
        )}
        {forms.map((f) => (
          <div
            key={f.id}
            className="flex items-center justify-between gap-3 rounded-md border p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{f.title}</p>
              <p className="text-xs text-muted-foreground">
                {f.fields.length} pertanyaan
                {f.slug ? ` · /r/${f.slug}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={f.status} />
              <ReviewFormActions
                form={{ id: f.id, status: f.status, slug: f.slug }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

async function PeriodsSection({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}) {
  const membership = await requireOrgRole(userId, orgId, "member");
  const isAdmin = membership.role === "admin" || membership.role === "owner";
  const [periods, allForms, members] = await Promise.all([
    listPeriods(orgId),
    listForms(orgId),
    listMembers(userId, orgId),
  ]);
  const forms = allForms.filter((f) => f.status === "active");
  const memberOptions = members.map((m) => ({
    id: m.user.id,
    label: m.user.name ?? m.user.email,
  }));
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Periode Penilaian</CardTitle>
          <CardDescription>
            Buka periode, tetapkan penilai, tutup untuk melihat agregat.
          </CardDescription>
        </div>
        {forms.length > 0 && (
          <NewPeriodDialog
            forms={forms.map((f) => ({ id: f.id, title: f.title }))}
          />
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {periods.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada periode.</p>
        )}
        {periods.map((p) => (
          <div key={p.id} className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-medium">{p.title}</p>
              <div className="flex items-center gap-2">
                <StatusBadge status={p.status} />
                {p.status === "open" && (
                  <>
                    {isAdmin && (
                      <AssignReviewersDialog
                        periodId={p.id}
                        members={memberOptions}
                      />
                    )}
                    <PeriodActions period={{ id: p.id }} />
                  </>
                )}
              </div>
            </div>
            {p.status === "closed" && p.results ? (
              <ResultsList
                results={
                  p.results as Record<
                    string,
                    { count: number; average: number }
                  >
                }
              />
            ) : (
              p.status === "open" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Assignments berjalan; tutup periode untuk agregat.
                </p>
              )
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ResultsList({
  results,
}: {
  results: Record<string, { count: number; average: number }>;
}) {
  const entries = Object.entries(results);
  if (entries.length === 0)
    return (
      <p className="mt-2 text-xs text-muted-foreground">Tidak ada respons.</p>
    );
  return (
    <ul className="mt-2 space-y-1">
      {entries.map(([userId, r]) => (
        <li key={userId} className="text-xs tabular-nums">
          Reviewee {userId.slice(0, 8)}…: rata-rata {r.average} ({r.count}{" "}
          penilai)
        </li>
      ))}
    </ul>
  );
}

async function MyAssignmentsSection({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}) {
  await requireOrgRole(userId, orgId, "member");
  const assignments = await listMyAssignments(userId, orgId);
  const pending = assignments.filter((a) => a.status === "pending");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Penilaian Untuk Saya</CardTitle>
        <CardDescription>
          {pending.length > 0
            ? `${pending.length} penilaian menunggu.`
            : "Semua penilaian sudah dikirim."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {assignments.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada assignment.</p>
        )}
        {assignments.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between gap-3 rounded-md border p-3"
          >
            <div>
              <p className="text-sm font-medium">
                {a.revieweeName ?? "Tanpa nama"}{" "}
                <span className="text-xs text-muted-foreground">
                  ({a.relation === "self" ? "diri sendiri" : a.relation})
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {a.status === "pending" ? "Menunggu diisi" : "Sudah dikirim"}
              </p>
            </div>
            {a.status === "pending" && (
              <SubmitReviewForm assignmentId={a.id} fields={a.fields} />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SectionSkeleton() {
  return <Skeleton className="h-48 w-full" />;
}

export default async function PenilaianPage() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Penilaian 360</h1>
        <p className="text-sm text-muted-foreground">
          Form, periode, dan penilaian atasan/rekan/bawahan/diri.
        </p>
      </div>
      <Suspense fallback={<SectionSkeleton />}>
        <MyAssignmentsSection orgId={ids.orgId} userId={ids.userId} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton />}>
        <AggregateSection orgId={ids.orgId} userId={ids.userId} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton />}>
        <PeriodsSection orgId={ids.orgId} userId={ids.userId} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton />}>
        <FormsSection orgId={ids.orgId} userId={ids.userId} />
      </Suspense>
    </div>
  );
}
