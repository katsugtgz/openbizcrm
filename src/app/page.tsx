import Link from "next/link";
import { Button } from "@/components/ui/button";

// Computed once at module evaluation (build time) — safe for static prerender.
const CURRENT_YEAR = new Date().getFullYear();

const modules = [
  {
    name: "HRM",
    what: "Payroll PPh 21 TER dan BPJS terhitung otomatis, absensi, cuti, penilaian kinerja.",
    tag: "gaji & absensi",
  },
  {
    name: "CRM",
    what: "Catat leads dan pelanggan, pantau pipeline penjualan sampai closing.",
    tag: "pipeline",
  },
  {
    name: "Akuntansi",
    what: "Jurnal otomatis dari transaksi, buku besar, dan laporan keuangan.",
    tag: "jurnal",
  },
  {
    name: "Proyek",
    what: "Rencanakan pekerjaan, tugaskan tim, pantau progres dan timesheet.",
    tag: "tugas & waktu",
  },
  {
    name: "Chat",
    what: "Percakapan real-time antar cabang dan departemen, tanpa pindah aplikasi.",
    tag: "tim",
  },
];

const slipRows: { label: string; value: string; deduction?: boolean }[] = [
  { label: "Gaji pokok", value: "Rp 8.500.000" },
  { label: "Tunjangan transport", value: "Rp 1.200.000" },
  { label: "BPJS Kesehatan", value: "Rp 340.000", deduction: true },
  { label: "BPJS JHT 3,7%", value: "Rp 314.500", deduction: true },
  { label: "PPh 21 TER (Kat. A)", value: "Rp 908.000", deduction: true },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <span className="text-lg font-semibold tracking-tight">
            OpenBizCRM
          </span>
          <Button asChild>
            <Link href="/login">Masuk</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6">
        <section className="grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-2">
          <div className="flex flex-col items-start gap-6">
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              Gaji beres tiap akhir bulan. Pipeline, jurnal, dan tim
              menyusulnya.
            </h1>
            <p className="max-w-xl text-pretty text-lg text-muted-foreground">
              OpenBizCRM menyatukan HRM, CRM, Akuntansi, Proyek, dan Chat dalam
              satu aplikasi. PPh 21 TER dan BPJS dihitung otomatis. Multi-cabang,
              multi-perusahaan, jalan sebagai PWA.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/login">Masuk</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">Coba Dashboard</Link>
              </Button>
            </div>
          </div>

          {/* Slip gaji: artefak yang paling khas dari payroll Indonesia. */}
          <figure
            className="w-full max-w-md justify-self-center motion-safe:animate-[slip-masuk_500ms_ease-out_both] lg:rotate-1"
            style={
              {
                animationTimingFunction: "cubic-bezier(.2,.8,.2,1)",
              } as React.CSSProperties
            }
          >
            <div className="rounded-md border bg-card p-6 text-card-foreground shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">Slip Gaji</p>
                  <p className="text-sm text-muted-foreground">
                    Oktober 2026, PT Nusantara Karya
                  </p>
                </div>
                <p className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
                  No. 071/HRM
                </p>
              </div>
              <p className="mb-4 text-sm">
                Dewi Anggraini, Admin HRM, Cabang Jakarta
              </p>
              <dl className="font-mono text-sm">
                {slipRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-baseline justify-between gap-4 border-t border-dashed py-1.5 first:border-t-0"
                  >
                    <dt className="min-w-0 flex-1 text-muted-foreground">{row.label}</dt>
                    <dd
                      className={`whitespace-nowrap ${
                        row.deduction ? "text-destructive" : ""
                      }`}
                    >
                      {row.deduction ? "− " : ""}{row.value}
                    </dd>
                  </div>
                ))}
                <div className="mt-2 flex items-baseline justify-between gap-4 border-t-2 border-foreground py-2 font-semibold">
                  <dt>Take-home pay</dt>
                  <dd className="tabular-nums">Rp 8.137.500</dd>
                </div>
              </dl>
              <div className="mt-4 flex items-end justify-between">
                <p className="max-w-40 text-xs text-muted-foreground">
                  Potongan dihitung dengan tarif efektif bulanan (TER) per
                  PMK 168/2023.
                </p>
                <span
                  aria-hidden="true"
                  className="-rotate-6 rounded-sm border-2 border-destructive px-2 py-0.5 font-mono text-sm font-bold tracking-wide text-destructive opacity-80"
                >
                  LUNAS
                </span>
              </div>
            </div>
            <figcaption className="mt-3 text-center text-xs text-muted-foreground">
              Contoh slip gaji yang dihasilkan otomatis.
            </figcaption>
          </figure>
        </section>

        <section id="modul" className="pb-20 sm:pb-24">
          <h2 className="mb-2 text-balance text-2xl font-semibold tracking-tight">
            Lima modul, satu catatan.
          </h2>
          <p className="mb-8 text-pretty text-muted-foreground">
            Semua modul menulis ke data yang sama, jadi absensi menjadi dasar
            gaji, dan gaji menjadi jurnal.
          </p>
          <dl className="grid grid-cols-1">
            {modules.map((modul) => (
              <div
                key={modul.name}
                className="flex flex-col gap-1 border-t border-dashed py-4 last:border-b sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
              >
                <div className="sm:flex sm:basis-[38rem] sm:items-baseline sm:gap-6">
                  <dt className="w-32 shrink-0 text-lg font-semibold">
                    {modul.name}
                  </dt>
                  <dd className="text-sm text-muted-foreground">
                    {modul.what}
                  </dd>
                </div>
                <p className="font-mono text-xs text-muted-foreground">
                  {modul.tag}
                </p>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 text-sm text-muted-foreground">
          © {CURRENT_YEAR} OpenBizCRM. Open-source, lisensi terbuka, dibuat di
          Indonesia.
        </div>
      </footer>
    </div>
  );
}
