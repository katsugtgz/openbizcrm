import Link from "next/link";
import { Button } from "@/components/ui/button";

// Computed once at module evaluation (build time) — safe for static prerender.
const CURRENT_YEAR = new Date().getFullYear();

const moduleGroups = [
  {
    id: "hrm",
    title: "HRM",
    description:
      "Kelola karyawan, absensi, cuti, payroll, dan penilaian kinerja tim Anda.",
  },
  {
    id: "crm",
    title: "CRM",
    description:
      "Kelola leads, peluang, pelanggan, dan pipeline penjualan dalam satu tempat.",
  },
  {
    id: "proyek",
    title: "Proyek",
    description:
      "Rencanakan proyek, tugaskan tugas, dan pantau progres serta timesheet.",
  },
  {
    id: "chat",
    title: "Chat",
    description:
      "Kolaborasi tim lewat percakapan real-time antar cabang dan departemen.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              OB
            </span>
            <span className="text-lg font-semibold tracking-tight">
              OpenBizCRM
            </span>
          </div>
          <Button asChild>
            <Link href="/login">Masuk</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6">
        <section className="flex flex-col items-center gap-6 py-24 text-center">
          <span className="rounded-full border px-4 py-1 text-sm text-muted-foreground">
            Open-source · Made in Indonesia
          </span>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Satu platform bisnis untuk HRM, CRM, Akuntansi, dan lebih banyak
            lagi.
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            OpenBizCRM membantu bisnis Indonesia mengelola karyawan, pelanggan,
            proyek, dan komunikasi tim — dalam satu aplikasi terpadu.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/login">Masuk</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/dashboard">Coba Dashboard</Link>
            </Button>
          </div>
        </section>

        <section id="modul" className="pb-24">
          <h2 className="mb-8 text-center text-2xl font-semibold tracking-tight">
            Modul
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {moduleGroups.map((group) => (
              <div
                key={group.id}
                className="flex flex-col gap-2 rounded-lg border bg-card p-6 text-card-foreground shadow-sm"
              >
                <h3 className="text-lg font-semibold">{group.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {group.description}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 text-center text-sm text-muted-foreground">
          © {CURRENT_YEAR} OpenBizCRM — Open-source, lisensi terbuka.
        </div>
      </footer>
    </div>
  );
}
