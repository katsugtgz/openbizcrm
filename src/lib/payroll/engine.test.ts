import { describe, it, expect } from "vitest";
import {
  overtimePay,
  prorateBase,
  thrProration,
  terTax,
  thrTax,
  bpjsEmployeeDeductions,
  computePayslip,
  terStatusFromTaxStatus,
  DEFAULT_WORKING_DAYS,
  type PayslipInput,
} from "./engine";

// Gaji pokok uji: habis dibagi 173 => upah/jam = Rp30.000 persis.
const BASE = 5_190_000;

describe("Overtime (UU 13/2003 Ps. 78(2), pembagi 173)", () => {
  it("hari kerja biasa 2 jam: 1,5x + 2x = 3,5 x Rp30.000 = Rp105.000", () => {
    expect(overtimePay(BASE, 2, 0)).toBe(105_000);
  });

  it("hari kerja biasa 1 jam: 1,5x = Rp45.000", () => {
    expect(overtimePay(BASE, 1, 0)).toBe(45_000);
  });

  it("hari libur 8 jam: 8 x 2x = 16 x Rp30.000 = Rp480.000", () => {
    expect(overtimePay(BASE, 0, 8)).toBe(480_000);
  });

  it("hari libur 10 jam: (16 + 2x3) = 22 x Rp30.000 = Rp660.000", () => {
    expect(overtimePay(BASE, 0, 10)).toBe(660_000);
  });

  it("hari libur 13 jam: (28 + 1x4) = 32 x Rp30.000 = Rp960.000", () => {
    expect(overtimePay(BASE, 0, 13)).toBe(960_000);
  });

  it("gabungan weekday + libur", () => {
    // 1.5 + 16 = 17.5 x 30000
    expect(overtimePay(BASE, 1, 8)).toBe(525_000);
  });

  it("menolak jam negatif / non-integer", () => {
    expect(() => overtimePay(BASE, -1, 0)).toThrow();
    expect(() => overtimePay(BASE, 1.5, 0)).toThrow();
  });
});

describe("Prorasi gaji karena izin tidak dibayar (UU 13/2003 Ps. 93)", () => {
  it("tanpa izin: gaji penuh", () => {
    expect(prorateBase(BASE, 0)).toBe(BASE);
  });

  it("3 hari izin tidak dibayar dari 21 hari kerja: floor(gaji x 18/21)", () => {
    expect(prorateBase(BASE, 3)).toBe(4_448_571);
  });

  it("workingDays eksplisit", () => {
    expect(prorateBase(2_100_000, 5, 20)).toBe(1_575_000);
  });

  it("izin >= hari kerja: gaji 0", () => {
    expect(prorateBase(BASE, DEFAULT_WORKING_DAYS)).toBe(0);
  });

  it("menolak izin negatif atau di atas hari kerja", () => {
    expect(() => prorateBase(BASE, -1)).toThrow();
    expect(() => prorateBase(BASE, DEFAULT_WORKING_DAYS + 1)).toThrow();
  });
});

describe("THR (Perpres 20/2018)", () => {
  it("12 bulan: THR penuh", () => {
    expect(thrProration(BASE, 12, true)).toBe(BASE);
  });

  it("7 bulan: floor(gaji x 7/12) = Rp3.027.500", () => {
    expect(thrProration(BASE, 7, true)).toBe(3_027_500);
  });

  it("6 bulan: setengah", () => {
    expect(thrProration(BASE, 6, true)).toBe(2_595_000);
  });

  it("includeThr false: 0", () => {
    expect(thrProration(BASE, 12, false)).toBe(0);
  });

  it("masa kerja < 1 bulan: 0", () => {
    expect(thrProration(BASE, 0, true)).toBe(0);
  });
});

describe("PPh 21 TER bulanan (PMK 168/2023)", () => {
  it("TK/0 pendapatan rendah: tarif 0 bps", () => {
    expect(terTax(5_000_000, "TK/0")).toBe(0);
  });

  it("TK/1 bruto 5jt (bracket 1, 25 bps): Rp12.500", () => {
    expect(terTax(5_000_000, "TK/1")).toBe(12_500);
  });

  it("K/I/3 bruto 60jt (bracket 2, 300 bps): Rp1.800.000", () => {
    expect(terTax(60_000_000, "K/I/3")).toBe(1_800_000);
  });

  it("pemetaan kode tax_status DB ke status TER", () => {
    expect(terStatusFromTaxStatus("TK0")).toBe("TK/0");
    expect(terStatusFromTaxStatus("TK3")).toBe("TK/3");
    expect(terStatusFromTaxStatus("KI0")).toBe("K/I/0");
    expect(terStatusFromTaxStatus("KI3")).toBe("K/I/3");
  });
});

describe("PPh 21 TER harian untuk THR", () => {
  it("THR 3.027.500 TK/1 (25 bps, dibulatkan): Rp7.569", () => {
    expect(thrTax(3_027_500, "TK/1")).toBe(7_569);
  });

  it("TK/0: 0", () => {
    expect(thrTax(3_027_500, "TK/0")).toBe(0);
  });
});

describe("BPJS", () => {
  it("kesehatan tepat di batas 12jt: pegawai 1% = Rp120.000, pemberi kerja 4% = Rp480.000", () => {
    const r = bpjsEmployeeDeductions(12_000_000);
    expect(r.kesehatanEmployee).toBe(120_000);
    expect(r.kesehatanEmployer).toBe(480_000);
  });

  it("di bawah batas 12jt (5jt): pegawai Rp50.000", () => {
    expect(bpjsEmployeeDeductions(5_000_000).kesehatanEmployee).toBe(50_000);
  });

  it("JHT di batas atas 10.042.300: 2% = Rp200.846", () => {
    expect(bpjsEmployeeDeductions(12_000_000).jhtEmployee).toBe(200_846);
  });

  it("JP di batas atas: 1% = Rp100.423", () => {
    expect(bpjsEmployeeDeductions(12_000_000).jpEmployee).toBe(100_423);
  });

  it("total pegawai = kesehatan + JHT + JP", () => {
    const r = bpjsEmployeeDeductions(5_000_000);
    expect(r.employeeTotal).toBe(
      r.kesehatanEmployee + r.jhtEmployee + r.jpEmployee,
    );
    expect(r.employeeTotal).toBe(200_000); // kesehatan 50.000 + JHT 100.000 + JP 50.000
  });

  it("menolak gaji negatif", () => {
    expect(() => bpjsEmployeeDeductions(-1)).toThrow();
  });
});

describe("computePayslip: known-answer utuh", () => {
  const input: PayslipInput = {
    employeeId: "e1",
    name: "Budi",
    taxStatus: "TK1",
    baseSalary: BASE,
    unpaidLeaveDays: 0,
    weekdayOvertimeHours: 2,
    restdayOvertimeHours: 0,
    monthsWorked: 12,
    includeThr: true,
  };

  const slip = computePayslip(input);

  it("komponen bruto persis", () => {
    expect(slip.proratedBase).toBe(BASE);
    expect(slip.overtime).toBe(105_000);
    expect(slip.thr).toBe(BASE);
    expect(slip.gross).toBe(10_485_000);
  });

  it("potongan persis: TER 13.238 + THR tax 12.975 + BPJS 207.600", () => {
    expect(slip.taxMonthly).toBe(13_238);
    expect(slip.taxThr).toBe(12_975);
    expect(slip.bpjs.employeeTotal).toBe(207_600);
    expect(slip.deductions).toBe(233_813);
  });

  it("identitas net = gross - deductions", () => {
    expect(slip.net).toBe(10_485_000 - 233_813);
    expect(slip.gross - slip.deductions).toBe(slip.net);
  });

  it("semua komponen rupiah integer non-negatif", () => {
    for (const v of [
      slip.proratedBase,
      slip.overtime,
      slip.thr,
      slip.gross,
      slip.taxMonthly,
      slip.taxThr,
      slip.deductions,
      slip.net,
    ]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("menolak gaji non-integer / negatif", () => {
    expect(() => computePayslip({ ...input, baseSalary: -1 })).toThrow();
    expect(() => computePayslip({ ...input, baseSalary: 1000.5 })).toThrow();
  });
});
