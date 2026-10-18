// Pure payroll engine — Indonesian rules (UU 13/2003, PMK 168/2023, Perpres
// 20/2018, PP 86/2015). NO DB imports; semua uang integer rupiah.
// Rounding: Math.round ke rupiah terdekat (round-half-up) di setiap langkah
// yang menghasilkan pecahan; strategi dideklarasikan di sini sesuai
// konvensi PAYROLL-SOURCES.md.
import { assertSafeAmount } from "@/lib/money";
import {
  TER_BULANAN,
  TER_HARIAN,
  terRateBps,
  BPJS_KESEHATAN,
  BPJS_TK,
  OVERTIME,
  type TerStatus,
} from "./reference-tables";

/** Hari kerja default per bulan (prorasi izin). ponytail: jadikan input
 * konfigurasi org bila kebijakan hari kerja berbeda per organisasi. */
export const DEFAULT_WORKING_DAYS = 21;

export type TaxStatusCode =
  "TK0" | "TK1" | "TK2" | "TK3" | "KI0" | "KI1" | "KI2" | "KI3";

/** "TK0" (enum DB) -> "TK/0" (kunci tabel TER). */
export function terStatusFromTaxStatus(code: TaxStatusCode): TerStatus {
  const m: Record<TaxStatusCode, TerStatus> = {
    TK0: "TK/0",
    TK1: "TK/1",
    TK2: "TK/2",
    TK3: "TK/3",
    KI0: "K/I/0",
    KI1: "K/I/1",
    KI2: "K/I/2",
    KI3: "K/I/3",
  };
  return m[code];
}

// ---------------------------------------------------------------------------
// Lembur
// ---------------------------------------------------------------------------

/** Upah lembur rupiah. weekdayHours pakai tarif hari kerja biasa,
 * restdayHours pakai tarif hari libur. Jam harus integer >= 0. */
export function overtimePay(
  baseSalary: number,
  weekdayHours: number,
  restdayHours: number,
): number {
  assertSafeAmount(baseSalary, "Gaji pokok");
  for (const h of [weekdayHours, restdayHours]) {
    if (!Number.isInteger(h) || h < 0) {
      throw new Error("Jam lembur harus integer >= 0.");
    }
  }
  const hourly = baseSalary / OVERTIME.hourlyWageDivisor;
  let units = 0;
  for (let h = 1; h <= weekdayHours; h++) units += OVERTIME.weekdayHourBps(h);
  for (let h = 1; h <= restdayHours; h++) units += OVERTIME.restDayHourBps(h);
  return Math.round((hourly * units) / 100);
}

// ---------------------------------------------------------------------------
// Prorasi gaji (izin tidak dibayar) & THR
// ---------------------------------------------------------------------------

/** Gaji diprorasi: floor(gaji x (workingDays - unpaidLeaveDays) / workingDays).
 * UU 13/2003 Ps. 93: upah tidak dibayar bila pekerja tidak bekerja. */
export function prorateBase(
  baseSalary: number,
  unpaidLeaveDays: number,
  workingDays = DEFAULT_WORKING_DAYS,
): number {
  assertSafeAmount(baseSalary, "Gaji pokok");
  if (!Number.isInteger(unpaidLeaveDays) || unpaidLeaveDays < 0) {
    throw new Error("Hari izin tidak dibayar harus integer >= 0.");
  }
  if (unpaidLeaveDays > workingDays) {
    throw new Error("Hari izin melebihi hari kerja.");
  }
  return Math.floor(
    (baseSalary * (workingDays - unpaidLeaveDays)) / workingDays,
  );
}

/** THR proporsional Perpres 20/2018: <12 bulan => floor(upah x bulan/12),
 * >=12 => penuh; <1 bulan atau includeThr false => 0. */
export function thrProration(
  baseSalary: number,
  monthsWorked: number,
  includeThr: boolean,
): number {
  assertSafeAmount(baseSalary, "Gaji pokok");
  if (!Number.isInteger(monthsWorked) || monthsWorked < 0) {
    throw new Error("Masa kerja harus integer >= 0 bulan.");
  }
  if (!includeThr || monthsWorked < 1) return 0;
  if (monthsWorked >= 12) return baseSalary;
  return Math.floor((baseSalary * monthsWorked) / 12);
}

// ---------------------------------------------------------------------------
// PPh 21 TER
// ---------------------------------------------------------------------------

/** TER bulanan atas bruto gaji (PMK 168/2023 Ps. 16). */
export function terTax(bruto: number, status: TerStatus): number {
  const bps = terRateBps(TER_BULANAN, bruto, status);
  return Math.round((bruto * bps) / 10_000);
}

/** TER harian atas THR/penghasilan tahunan (PMK 168/2023 Ps. 17). */
export function thrTax(thrAmount: number, status: TerStatus): number {
  const bps = terRateBps(TER_HARIAN, thrAmount, status);
  return Math.round((thrAmount * bps) / 10_000);
}

// ---------------------------------------------------------------------------
// BPJS
// ---------------------------------------------------------------------------

export interface BpjsBreakdown {
  kesehatanEmployee: number;
  kesehatanEmployer: number;
  jhtEmployee: number;
  jpEmployee: number;
  /** Total potongan dari gaji pegawai. */
  employeeTotal: number;
}

/** Iuran BPJS atas upah (gaji pokok + tunjangan tetap; di sini = gaji pokok
 * prorasi). Kesehatan di-cap kelas Rp12jt; JHT/JP di-cap Rp10.042.300. */
export function bpjsEmployeeDeductions(wage: number): BpjsBreakdown {
  assertSafeAmount(wage, "Upah BPJS");
  const kes = BPJS_KESEHATAN.categories.penerimaUpahUmum;
  const kesBase = Math.min(wage, BPJS_KESEHATAN.wageCapClass1);
  const tkBase = Math.min(wage, BPJS_TK.wageCapJhtJp);
  const kesehatanEmployee = Math.round((kesBase * kes.employeeBps) / 10_000);
  const kesehatanEmployer = Math.round((kesBase * kes.employerBps) / 10_000);
  const jhtEmployee = Math.round((tkBase * BPJS_TK.jht.employeeBps) / 10_000);
  const jpEmployee = Math.round((tkBase * BPJS_TK.jp.employeeBps) / 10_000);
  return {
    kesehatanEmployee,
    kesehatanEmployer,
    jhtEmployee,
    jpEmployee,
    employeeTotal: kesehatanEmployee + jhtEmployee + jpEmployee,
  };
}

// ---------------------------------------------------------------------------
// Payslip utuh
// ---------------------------------------------------------------------------

export interface PayslipInput {
  employeeId: string;
  name: string;
  taxStatus: TaxStatusCode;
  /** Gaji pokok bulanan sebelum prorasi. */
  baseSalary: number;
  unpaidLeaveDays: number;
  weekdayOvertimeHours: number;
  restdayOvertimeHours: number;
  monthsWorked: number;
  includeThr: boolean;
}

export interface Payslip extends PayslipInput {
  proratedBase: number;
  overtime: number;
  thr: number;
  /** proratedBase + overtime + thr. */
  gross: number;
  taxMonthly: number;
  taxThr: number;
  bpjs: BpjsBreakdown;
  /** taxMonthly + taxThr + bpjs.employeeTotal. */
  deductions: number;
  /** gross - deductions. */
  net: number;
}

export function computePayslip(input: PayslipInput): Payslip {
  const proratedBase = prorateBase(input.baseSalary, input.unpaidLeaveDays);
  const overtime = overtimePay(
    input.baseSalary,
    input.weekdayOvertimeHours,
    input.restdayOvertimeHours,
  );
  const thr = thrProration(
    input.baseSalary,
    input.monthsWorked,
    input.includeThr,
  );
  const gross = proratedBase + overtime + thr;
  const status = terStatusFromTaxStatus(input.taxStatus);
  const taxMonthly = terTax(proratedBase + overtime, status);
  const taxThr = thrTax(thr, status);
  const bpjs = bpjsEmployeeDeductions(proratedBase);
  const deductions = taxMonthly + taxThr + bpjs.employeeTotal;
  return {
    ...input,
    proratedBase,
    overtime,
    thr,
    gross,
    taxMonthly,
    taxThr,
    bpjs,
    deductions,
    net: gross - deductions,
  };
}
