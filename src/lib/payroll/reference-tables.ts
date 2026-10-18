// Tabel referensi PPh 21 TER (PMK 168/2023) + BPJS.
// Semua persentase disimpan sebagai basis points (bps) agar perhitungan tetap integer.
// Status verifikasi tiap angka: lihat src/lib/payroll/PAYROLL-SOURCES.md (as-of 2026-10-19).

export type TerStatus =
  | "TK/0"
  | "TK/1"
  | "TK/2"
  | "TK/3"
  | "K/0"
  | "K/1"
  | "K/2"
  | "K/3"
  | "K/I/0"
  | "K/I/1"
  | "K/I/2"
  | "K/I/3";

export interface TerBracket {
  /** Batas atas bruto bulanan (rupiah integer); null = tanpa batas. */
  maxBruto: number | null;
  /** Tarif per status karyawan, dalam bps (50 = 0,5%). */
  ratesBps: Record<TerStatus, number>;
}

// Pasal 16 PMK 168/2023 — TER bulanan. Bruto = gaji pokok + tunjangan tetap
// dikurangi iuran pensiun/jaminan hari tua/JP yang dibayar pegawai sendiri.
export const TER_BULANAN: TerBracket[] = [
  {
    maxBruto: 53_900_000,
    ratesBps: {
      "TK/0": 0,
      "TK/1": 25,
      "TK/2": 50,
      "TK/3": 100,
      "K/0": 0,
      "K/1": 50,
      "K/2": 100,
      "K/3": 150,
      "K/I/0": 0,
      "K/I/1": 75,
      "K/I/2": 150,
      "K/I/3": 200,
    },
  },
  {
    maxBruto: 565_000_000,
    ratesBps: {
      "TK/0": 50,
      "TK/1": 100,
      "TK/2": 150,
      "TK/3": 200,
      "K/0": 125,
      "K/1": 150,
      "K/2": 200,
      "K/3": 250,
      "K/I/0": 100,
      "K/I/1": 150,
      "K/I/2": 250,
      "K/I/3": 300,
    },
  },
  {
    maxBruto: 5_895_000_000,
    ratesBps: {
      "TK/0": 100,
      "TK/1": 150,
      "TK/2": 200,
      "TK/3": 250,
      "K/0": 150,
      "K/1": 175,
      "K/2": 225,
      "K/3": 275,
      "K/I/0": 150,
      "K/I/1": 200,
      "K/I/2": 250,
      "K/I/3": 300,
    },
  },
  {
    maxBruto: null,
    ratesBps: {
      "TK/0": 100,
      "TK/1": 150,
      "TK/2": 200,
      "TK/3": 250,
      "K/0": 150,
      "K/1": 225,
      "K/2": 300,
      "K/3": 375,
      "K/I/0": 150,
      "K/I/1": 250,
      "K/I/2": 350,
      "K/I/3": 450,
    },
  },
];

// Pasal 17 PMK 168/2023 — TER harian (dipakai untuk penghasilan THR/tahunan dari pemberi kerja).
export const TER_HARIAN: TerBracket[] = [
  {
    maxBruto: 2_500_000,
    ratesBps: {
      "TK/0": 0,
      "TK/1": 0,
      "TK/2": 0,
      "TK/3": 0,
      "K/0": 0,
      "K/1": 0,
      "K/2": 0,
      "K/3": 0,
      "K/I/0": 0,
      "K/I/1": 0,
      "K/I/2": 0,
      "K/I/3": 0,
    },
  },
  {
    maxBruto: 24_500_000,
    ratesBps: {
      "TK/0": 0,
      "TK/1": 25,
      "TK/2": 50,
      "TK/3": 100,
      "K/0": 25,
      "K/1": 50,
      "K/2": 100,
      "K/3": 125,
      "K/I/0": 50,
      "K/I/1": 100,
      "K/I/2": 150,
      "K/I/3": 200,
    },
  },
  {
    maxBruto: 47_500_000,
    ratesBps: {
      "TK/0": 25,
      "TK/1": 50,
      "TK/2": 100,
      "TK/3": 150,
      "K/0": 50,
      "K/1": 100,
      "K/2": 150,
      "K/3": 200,
      "K/I/0": 100,
      "K/I/1": 150,
      "K/I/2": 200,
      "K/I/3": 250,
    },
  },
  {
    maxBruto: 505_000_000,
    ratesBps: {
      "TK/0": 50,
      "TK/1": 100,
      "TK/2": 150,
      "TK/3": 200,
      "K/0": 125,
      "K/1": 150,
      "K/2": 200,
      "K/3": 250,
      "K/I/0": 150,
      "K/I/1": 200,
      "K/I/2": 250,
      "K/I/3": 300,
    },
  },
  {
    maxBruto: null,
    ratesBps: {
      "TK/0": 50,
      "TK/1": 100,
      "TK/2": 150,
      "TK/3": 200,
      "K/0": 125,
      "K/1": 200,
      "K/2": 250,
      "K/3": 300,
      "K/I/0": 150,
      "K/I/1": 250,
      "K/I/2": 350,
      "K/I/3": 450,
    },
  },
];

/** Cari tarif TER (bps) untuk bruto + status. Melempar bila bruto tidak valid. */
export function terRateBps(
  table: TerBracket[],
  bruto: number,
  status: TerStatus,
): number {
  if (!Number.isInteger(bruto) || bruto < 0) {
    throw new Error("Bruto harus integer >= 0.");
  }
  const bracket = table.find((b) => b.maxBruto === null || bruto <= b.maxBruto);
  if (!bracket)
    throw new Error(
      "Tabel TER tidak lengkap: tidak ada bracket untuk bruto ini.",
    );
  return bracket.ratesBps[status];
}

// BPJS Kesehatan (PP 86/2015 jo. PP 37/2021) — penerima upah umum: 4% + 1%.
// Batas upah perhitungan kelas Rp12.000.000 (kelas 1).
export const BPJS_KESEHATAN = {
  /** Batas upah untuk perhitungan kontribusi kelas (kelas 1 = upah > Rp12.000.000). */
  wageCapClass1: 12_000_000,
  categories: {
    /** Pegawai penerima upah umum. */
    penerimaUpahUmum: { employerBps: 400, employeeBps: 100 },
    /** PNS/TNI/Polri/BUMD/BUMN. */
    pnsTniPolri: { employerBps: 200, employeeBps: 100 },
    /** Bukan penerima upah (biaya sendiri). */
    bukanPenerimaUpah: { employerBps: 0, employeeBps: 200 },
  } as const,
};

// BPJS Ketenagakerjaan (PP 86/2013 jo. PP 45/2015 & PP 46/2015).
// Persentase atas UP toward JKK/JKM tidak ada batas upah; JHT & JP dibatasi.
export const BPJS_TK = {
  /** Batas upah bulanan JHT & JP: Rp10.042.300 (PP 45/2015). ponytail: verifikasi ulang
   * PP terbaru sebelum produksi; angka belum dicek ulang per 2026 (lihat PAYROLL-SOURCES.md). */
  wageCapJhtJp: 10_042_300,
  jht: { employerBps: 370, employeeBps: 200 },
  jp: { employerBps: 200, employeeBps: 100 },
  /** JKM: 0,3% ditanggung pemberi kerja, tanpa batas upah. */
  jkm: { employerBps: 30 },
  /**
   * JKK: matriks kelas risiko (Permenaker No. 05/MEN/1996), ditanggung pemberi kerja,
   * tanpa batas upah. ponytail: tugas awal menyebut 3 kelas (0,24–1,74%); regulasi
   * memuat 5 kelas — kelas I–V dimuat lengkap.
   */
  jkkClassBps: { I: 24, II: 54, III: 96, IV: 126, V: 174 } as Record<
    string,
    number
  >,
} as const;

// Upah lembur — UU 13/2003 Pasal 78(2) + PP 35/2021.
// Upah/jam = 1/173 x upah bulanan (173 = 25 hari x 7 jam + 1/12 x 52 libur resmi).
export const OVERTIME = {
  hourlyWageDivisor: 173,
  /** Hari kerja biasa: jam ke-1 = 1,5x; jam ke-2 dst = 2x. */
  weekdayHourBps(hour: number): number {
    return hour === 1 ? 150 : 200;
  },
  /**
   * Hari libur/hari istirahat: jam 1–8 = 2x; jam 9–12 = 3x; jam 13+ = 4x.
   * ponytail: pola 5-hari-kerja resminya berbeda (jam 9 = 3x, jam 10–12 = 4x per
   * Kepmenaker 102/2004); tabel 6-hari ini mengikuti angka yang ditetapkan tugas.
   */
  restDayHourBps(hour: number): number {
    if (hour < 1) throw new Error("Jam lembur harus >= 1.");
    if (hour <= 8) return 200;
    if (hour <= 12) return 300;
    return 400;
  },
} as const;
