import { requireOrgRole } from "@/lib/org-scope";
import { listMembers } from "@/lib/repos/member-repo";
import { listPeriods, listResponsesForPeriod } from "@/lib/review/service";
import { aggregate360, type Agg360Entry } from "@/lib/review/aggregate";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Tampilan agregat per reviewee (admin): rata-rata 360 dihitung dari
 * respons langsung (bukan menunggu closePeriod), per periode terbuka.
 */
export async function AggregateSection({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}) {
  await requireOrgRole(userId, orgId, "member");
  const periods = await listPeriods(orgId);
  const members = await listMembers(userId, orgId);
  const nameById = new Map(
    members.map((m) => [m.user.id, m.user.name ?? m.user.email]),
  );

  const active = periods.filter((p) => p.status !== "draft");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agregat per Reviewee (Admin)</CardTitle>
        <CardDescription>
          Rekap rata-rata penilaian per orang, dihitung dari respons masuk.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {active.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Belum ada periode penilaian.
          </p>
        )}
        {active.map(async (p) => {
          const rows = await listResponsesForPeriod(orgId, p.id);
          const agg: Map<string, Agg360Entry> = aggregate360(
            rows.map((r) => ({
              revieweeUserId: r.assignment.revieweeUserId,
              answers: r.response.answers,
            })),
          );
          return (
            <div key={p.id} className="rounded-md border p-3">
              <p className="text-sm font-medium">{p.title}</p>
              {agg.size === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Belum ada respons.
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {[...agg.entries()].map(([reviewee, e]) => (
                    <li
                      key={reviewee}
                      className="flex items-center justify-between text-xs tabular-nums"
                    >
                      <span className="truncate">
                        {nameById.get(reviewee) ?? reviewee.slice(0, 8) + "…"}
                      </span>
                      <span>
                        rata-rata {e.average} ({e.count} penilai)
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
