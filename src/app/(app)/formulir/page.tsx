import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { listForms } from "@/lib/review/service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export const metadata = { title: "Formulir" };

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Aktif",
  closed: "Ditutup",
};

/**
 * Admin semua form penilaian org: definisi field, status publish, dan
 * tautan publik /r/<slug>. Manajemen (buat/publish/tutup) tetap di /penilaian.
 */
export default async function FormulirPage() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  await requireOrgRole(ids.userId, ids.orgId, "member");
  const forms = await listForms(ids.orgId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Formulir</h1>
        <p className="text-sm text-muted-foreground">
          Semua formulir penilaian organisasi dan tautan publiknya.
        </p>
      </div>
      <div className="space-y-3">
        {forms.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Belum ada formulir. Buat di halaman Penilaian 360.
          </p>
        )}
        {forms.map((f) => (
          <Card key={f.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="min-w-0">
                <CardTitle className="text-base">{f.title}</CardTitle>
                <CardDescription className="truncate">
                  {f.description ?? "Tanpa deskripsi"} · {f.fields.length}{" "}
                  pertanyaan
                </CardDescription>
              </div>
              <Badge>{STATUS_LABEL[f.status] ?? f.status}</Badge>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3">
              {f.slug && f.status === "active" ? (
                <span
                  className="text-sm text-primary underline underline-offset-4"
                  title="Pratinjau — pengisian butuh tautan ber-token per penilai (?a=assignmentId) yang dibagikan dari halaman Penilaian"
                >
                  /r/{f.slug} (pratinjau)
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Tautan publik muncul setelah publish.
                </span>
              )}
              <Button asChild size="sm" variant="outline">
                <Link href="/penilaian">Kelola di Penilaian</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
