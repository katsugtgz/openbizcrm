import { redirect } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { listAnnouncements, listCourses } from "@/lib/review/service";
import { listAttendances } from "@/lib/repos/hrm-repo";
import { jakartaDateISO } from "@/lib/attendance/rules";
import { listDeals } from "@/lib/repos/crm-repo";
import { financialReports } from "@/lib/accounting/service";
import { formatIDR } from "@/lib/money";
import { db } from "@/db";
import { courseCompletions } from "@/db/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Laporan" };

/**
 * Laporan lintas modul (level app, berbeda dari akuntansi/laporan):
 * kartu ringkas presensi hari ini, deal terbuka, pendapatan MTD, kursus
 * selesai, dan pengumuman terbaru.
 */
export default async function LaporanPage() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  await requireOrgRole(ids.userId, ids.orgId, "member");

  const today = jakartaDateISO(new Date());
  // Hanya kursus berbeda yang pernah selesai (cubic laporan/page.tsx:77):
  // jumlah baris completion lintas user membuat kartu "dari N kursus" tak
  // bermakna; distinct course memberi cakupan kursus.
  const completions = await db
    .selectDistinct({ courseId: courseCompletions.courseId })
    .from(courseCompletions)
    .where(eq(courseCompletions.orgId, ids.orgId));
  const [attendancesToday, deals, reports, courses, announcements] =
    await Promise.all([
      listAttendances(ids.orgId, { from: today, to: today }),
      listDeals(ids.orgId),
      // Gagal query akuntansi tetap terlihat (cubic laporan/page.tsx:46):
      // strip minus + label tidak tersedia, bukan dash yang mirip nol.
      financialReports(ids.orgId, today.slice(0, 7)).catch(
        () => "error" as const,
      ),
      listCourses(ids.orgId),
      listAnnouncements(ids.orgId),
    ]);
  const revenueMtd: number | "error" | null =
    reports === "error"
      ? "error"
      : reports
        ? reports.income.revenue.reduce<number>((s, r) => s + r.balance, 0)
        : null;
  const openDeals = deals.filter((d) => d.status === "open");
  const openValue = openDeals.reduce((s, d) => s + d.value, 0);
  // Hadir = status kehadiran nyata (cubic laporan/page.tsx:59) — absent dan
  // leave bukan hadir.
  const presentCount = attendancesToday.filter((a) =>
    ["ontime", "late", "wfh"].includes(a.status),
  ).length;

  const cards = [
    {
      title: "Presensi Hari Ini",
      value: `${presentCount}`,
      desc: "karyawan tercatat hadir",
      href: "/presensi",
    },
    {
      title: "Deal Terbuka",
      value: `${openDeals.length}`,
      desc: `nilai total ${formatIDR(openValue)}`,
      href: "/crm",
    },
    {
      title: "Pendapatan Bulan Ini",
      value:
        revenueMtd === "error"
          ? "Tidak tersedia"
          : revenueMtd === null
            ? "—"
            : formatIDR(revenueMtd),
      desc:
        revenueMtd === "error"
          ? "gagal memuat data akuntansi"
          : "akumulasi akun pendapatan (MTD)",
      href: "/akuntansi/laporan",
    },
    {
      title: "Kursus Selesai",
      value: `${completions.length}`,
      desc: `dari ${courses.length} kursus`,
      href: "/lms",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Laporan</h1>
        <p className="text-sm text-muted-foreground">
          Ringkasan lintas modul organisasi.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.title} href={c.href} className="group">
            <Card className="transition-colors group-hover:border-primary">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {c.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold tabular-nums">{c.value}</p>
                <p className="text-xs text-muted-foreground">{c.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pengumuman Terbaru</CardTitle>
          <CardDescription>5 terakhir.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {announcements.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Belum ada pengumuman.
            </p>
          )}
          {announcements.slice(0, 5).map((a) => (
            <div key={a.id} className="rounded-md border px-3 py-2">
              <p className="text-sm font-medium">{a.title}</p>
              <p className="truncate text-xs text-muted-foreground">{a.body}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
