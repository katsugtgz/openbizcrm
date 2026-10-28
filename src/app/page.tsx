import Link from "next/link";
import { Button } from "@/components/ui/button";

// Computed once at module evaluation (build time) — safe for static prerender.
const CURRENT_YEAR = new Date().getFullYear();

// paper–ink palette (deliberate, not the neutral shadcn default)
const ink = "oklch(0.24 0.035 255)";
const paper = "oklch(0.982 0.008 85)";
const stamp = "oklch(0.52 0.19 27)";

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

// urutan nyata: data mengalir satu arah dari absensi ke laporan
const flow = [
  { n: "01", t: "Absensi tercatat", d: "mesin, GPS, atau manual" },
  { n: "02", t: "Gaji dihitung", d: "TER & BPJS otomatis" },
  { n: "03", t: "Jurnal terbentuk", d: "tanpa entri ganda" },
  { n: "04", t: "Laporan siap", d: "lengkap per cabang" },
];

const slipRows: { label: string; value: string; deduction?: boolean }[] = [
  { label: "Gaji pokok", value: "Rp 8.500.000" },
  { label: "Tunjangan transport", value: "Rp 1.200.000" },
  { label: "BPJS Kesehatan", value: "Rp 340.000", deduction: true },
  { label: "BPJS JHT 3,7%", value: "Rp 314.500", deduction: true },
  { label: "PPh 21 TER (Kat. A)", value: "Rp 908.000", deduction: true },
];

const linkCls =
  "rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:[outline-color:var(--ol-ink)]";

export default function Home() {
  return (
    <div
      className="flex flex-1 flex-col"
      style={
        {
          "--ol-ink": ink,
          "--ol-paper": paper,
          "--ol-stamp": stamp,
          backgroundColor: paper,
          color: ink,
        } as React.CSSProperties
      }
    >
      <header className="border-b border-[color-mix(in_oklch,var(--ol-ink)_15%,transparent)]">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <a
            href="#"
            className={`flex items-baseline gap-2.5 text-lg font-semibold tracking-tight ${linkCls}`}
          >
            <span
              aria-hidden="true"
              className="inline-block size-3 self-center border-2 border-t-4 [border-color:var(--ol-ink)]"
            />
            OpenBizCRM
          </a>
          <nav className="flex items-center gap-6">
            <a
              href="#aliran"
              className={`hidden text-sm hover:underline sm:inline-block ${muted(70)}`}
            >
              Aliran data
            </a>
            <a
              href="#modul"
              className={`hidden text-sm hover:underline sm:inline-block ${muted(70)}`}
            >
              Modul
            </a>
            <Button
              asChild
              className="rounded-none [background-color:var(--ol-ink)] [color:var(--ol-paper)] hover:[background-color:color-mix(in_oklch,var(--ol-ink)_85%,var(--ol-paper))]"
            >
              <Link href="/login">Masuk</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6">
        <section className="grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col items-start gap-6">
            <h1
              className="text-balance text-4xl leading-[1.08] font-medium tracking-tight sm:text-5xl lg:text-[3.4rem]"
              style={{ fontFamily: "var(--font-display), Georgia, serif" }}
            >
              Gaji beres tiap akhir bulan. Pipeline, jurnal, dan tim
              menyusulnya.
            </h1>
            <p
              className={`max-w-xl text-pretty text-lg leading-relaxed ${muted(72)}`}
            >
              OpenBizCRM menyatukan HRM, CRM, Akuntansi, Proyek, dan Chat dalam
              satu aplikasi. PPh 21 TER dan BPJS dihitung otomatis.
              Multi-cabang, multi-perusahaan, jalan sebagai PWA.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                asChild
                size="lg"
                className="rounded-none px-7 [background-color:var(--ol-ink)] [color:var(--ol-paper)] hover:[background-color:color-mix(in_oklch,var(--ol-ink)_85%,var(--ol-paper))]"
              >
                <Link href="/login">Masuk</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-none border-[color:var(--ol-ink)] bg-transparent [color:var(--ol-ink)] hover:[background-color:color-mix(in_oklch,var(--ol-ink)_8%,transparent)]"
              >
                <Link href="/login">Coba Dashboard</Link>
              </Button>
            </div>
          </div>

          {/* Slip gaji: artefak yang paling khas dari payroll Indonesia. */}
          <figure className="w-full max-w-md justify-self-center motion-safe:animate-[slip-masuk_500ms_cubic-bezier(.2,.8,.2,1)_both]">
            <div className="border border-[color:color-mix(in_oklch,var(--ol-ink)_35%,transparent)] bg-white shadow-[6px_6px_0_0_var(--ol-ink)]">
              <div className="flex items-center justify-between gap-3 border-b-2 border-[color:var(--ol-ink)] px-6 py-3">
                <p className="text-sm font-semibold tracking-wide">
                  SLIP GAJI
                </p>
                <p className={`font-mono text-xs ${muted(70)}`}>
                  No. 071/HRM · Oktober 2026
                </p>
              </div>
              <div className="px-6 py-5">
                <p className="mb-1 text-sm font-medium">
                  Dewi Anggraini — Admin HRM
                </p>
                <p className={`mb-4 text-xs ${muted(60)}`}>
                  PT Nusantara Karya, Cabang Jakarta
                </p>
                <dl className="font-mono text-sm">
                  {slipRows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-baseline justify-between gap-4 border-t border-dashed border-[color:color-mix(in_oklch,var(--ol-ink)_25%,transparent)] py-1.5 first:border-t-0"
                    >
                      <dt className={`min-w-0 flex-1 ${muted(65)}`}>
                        {row.label}
                      </dt>
                      <dd className="whitespace-nowrap tabular-nums">
                        {row.deduction ? "− " : ""}
                        {row.value}
                      </dd>
                    </div>
                  ))}
                  <div className="mt-2 flex items-baseline justify-between gap-4 border-t-2 border-[color:var(--ol-ink)] py-2.5 text-base font-semibold">
                    <dt>Take-home pay</dt>
                    <dd className="tabular-nums">Rp 8.137.500</dd>
                  </div>
                </dl>
                <div className="mt-4 flex items-end justify-between gap-4">
                  <p className={`max-w-52 text-xs leading-snug ${muted(55)}`}>
                    Potongan dihitung dengan tarif efektif bulanan (TER) per
                    PMK 168/2023.
                  </p>
                  <span
                    aria-hidden="true"
                    className="-rotate-6 rounded-sm border-2 px-2 py-0.5 font-mono text-sm font-bold tracking-wide transition-transform duration-300 ease-out hover:rotate-0 [border-color:var(--ol-stamp)] [color:var(--ol-stamp)]"
                  >
                    LUNAS
                  </span>
                </div>
              </div>
            </div>
            <figcaption className={`mt-3 text-center text-xs ${muted(55)}`}>
              Contoh slip gaji yang dihasilkan otomatis.
            </figcaption>
          </figure>
        </section>

        <section
          id="aliran"
          className="border-t border-[color:color-mix(in_oklch,var(--ol-ink)_15%,transparent)] pb-20 pt-14 [content-visibility:auto] [contain-intrinsic-size:auto_320px] sm:pb-24"
        >
          <h2
            className="mb-10 text-2xl font-medium tracking-tight"
            style={{ fontFamily: "var(--font-display), Georgia, serif" }}
          >
            Satu arah: dari absensi sampai laporan.
          </h2>
          <ol className="grid grid-cols-1 gap-px bg-[color:color-mix(in_oklch,var(--ol-ink)_15%,transparent)] sm:grid-cols-2 lg:grid-cols-4">
            {flow.map((f) => (
              <li
                key={f.n}
                className="bg-[color:var(--ol-paper)] p-5 transition-colors hover:bg-[color:color-mix(in_oklch,var(--ol-ink)_5%,var(--ol-paper))]"
              >
                <p className={`font-mono text-xs ${muted(50)}`}>{f.n}</p>
                <p className="mt-2 font-medium">{f.t}</p>
                <p className={`mt-1 text-sm ${muted(65)}`}>{f.d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          id="modul"
          className="border-t border-[color:color-mix(in_oklch,var(--ol-ink)_15%,transparent)] pb-20 pt-14 [content-visibility:auto] [contain-intrinsic-size:auto_520px] sm:pb-24"
        >
          <h2
            className="mb-2 text-balance text-2xl font-medium tracking-tight"
            style={{ fontFamily: "var(--font-display), Georgia, serif" }}
          >
            Lima modul, satu catatan.
          </h2>
          <p className={`mb-8 max-w-xl text-pretty ${muted(72)}`}>
            Semua modul menulis ke data yang sama, jadi absensi menjadi dasar
            gaji, dan gaji menjadi jurnal.
          </p>
          <dl className="grid grid-cols-1">
            {modules.map((modul) => (
              <div
                key={modul.name}
                className="flex flex-col gap-1 border-t border-[color:color-mix(in_oklch,var(--ol-ink)_20%,transparent)] py-4 transition-colors last:border-b hover:bg-[color:color-mix(in_oklch,var(--ol-ink)_4%,transparent)] sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
              >
                <div className="sm:flex sm:basis-[38rem] sm:items-baseline sm:gap-6">
                  <dt
                    className="w-32 shrink-0 text-lg font-medium"
                    style={{
                      fontFamily: "var(--font-display), Georgia, serif",
                    }}
                  >
                    {modul.name}
                  </dt>
                  <dd className={`text-sm ${muted(72)}`}>{modul.what}</dd>
                </div>
                <p className={`font-mono text-xs ${muted(55)}`}>{modul.tag}</p>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="border-t border-[color:color-mix(in_oklch,var(--ol-ink)_15%,transparent)]">
        <div
          className={`mx-auto w-full max-w-6xl px-6 py-8 text-sm ${muted(60)}`}
        >
          © {CURRENT_YEAR} OpenBizCRM. Open-source, lisensi terbuka, dibuat di
          Indonesia.
        </div>
      </footer>
    </div>
  );
}

// ink mixed into paper — one helper keeps every muted tone in the same family
function muted(pct: number) {
  return `[color:color-mix(in_oklch,var(--ol-ink)_${pct}%,var(--ol-paper))]`;
}
