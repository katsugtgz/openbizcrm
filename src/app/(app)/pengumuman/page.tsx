import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { listAnnouncements } from "@/lib/review/service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NewAnnouncementDialog } from "./announcement-dialog";

export const metadata = { title: "Pengumuman" };

function formatWIB(date: Date): string {
  const shifted = new Date(date.getTime() + 7 * 60 * 60_000);
  return shifted.toISOString().replace("T", " ").slice(0, 16) + " WIB";
}

export default async function PengumumanPage() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/");
  await requireOrgRole(ids.userId, ids.orgId, "member");
  const items = await listAnnouncements(ids.orgId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Pengumuman</h1>
          <p className="text-sm text-muted-foreground">
            Kabar internal organisasi.
          </p>
        </div>
        <NewAnnouncementDialog />
      </div>
      <div className="space-y-3">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada pengumuman.</p>
        )}
        {items.map((a) => (
          <Card key={a.id}>
            <CardHeader>
              <CardTitle className="text-base">{a.title}</CardTitle>
              <CardDescription>{formatWIB(a.createdAt)}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">{a.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
