import { describe, it, expect } from "vitest";
import {
  TER_BULANAN,
  TER_HARIAN,
  terRateBps,
  BPJS_KESEHATAN,
  BPJS_TK,
  OVERTIME,
  type TerStatus,
} from "./reference-tables";

const ALL: TerStatus[] = [
  "TK/0",
  "TK/1",
  "TK/2",
  "TK/3",
  "K/0",
  "K/1",
  "K/2",
  "K/3",
  "K/I/0",
  "K/I/1",
  "K/I/2",
  "K/I/3",
];

describe("TER tables", () => {
  it("setiap bracket memuat tarif lengkap 12 status", () => {
    for (const table of [TER_BULANAN, TER_HARIAN]) {
      for (const b of table) {
        expect(Object.keys(b.ratesBps).sort()).toEqual([...ALL].sort());
      }
    }
  });

  it("bracket terakhir selalu tanpa batas atas", () => {
    expect(TER_BULANAN.at(-1)!.maxBruto).toBeNull();
    expect(TER_HARIAN.at(-1)!.maxBruto).toBeNull();
  });

  it("menolak bruto negatif / non-integer", () => {
    expect(() => terRateBps(TER_BULANAN, -1, "TK/0")).toThrow();
    expect(() => terRateBps(TER_BULANAN, 1000.5, "TK/0")).toThrow();
  });

  it("TK/0 di bulanan bracket pertama = 0 bps", () => {
    expect(terRateBps(TER_BULANAN, 5_000_000, "TK/0")).toBe(0);
  });

  it("bracket bulanan terakhir (bruto besar) memakai tarif bracket atas", () => {
    const last = TER_BULANAN.at(-1)!.ratesBps;
    expect(terRateBps(TER_BULANAN, 9_000_000_000, "TK/0")).toBe(last["TK/0"]);
    expect(terRateBps(TER_BULANAN, 9_000_000_000, "K/I/3")).toBe(last["K/I/3"]);
  });

  it("K/I/3 tarif di atas K/3 di semua bracket", () => {
    for (const b of TER_BULANAN) {
      expect(b.ratesBps["K/I/3"]).toBeGreaterThan(b.ratesBps["K/3"]);
    }
  });
});

describe("BPJS", () => {
  it("Kesehatan penerima upah umum = 4% + 1%, PNS = 2% + 1%", () => {
    expect(BPJS_KESEHATAN.categories.penerimaUpahUmum).toEqual({
      employerBps: 400,
      employeeBps: 100,
    });
    expect(BPJS_KESEHATAN.categories.pnsTniPolri).toEqual({
      employerBps: 200,
      employeeBps: 100,
    });
    expect(BPJS_KESEHATAN.wageCapClass1).toBe(12_000_000);
  });

  it("Ketenagakerjaan JHT 3,7/2, JP 2/1, JKM 0,3", () => {
    expect(BPJS_TK.jht).toEqual({ employerBps: 370, employeeBps: 200 });
    expect(BPJS_TK.jp).toEqual({ employerBps: 200, employeeBps: 100 });
    expect(BPJS_TK.jkm).toEqual({ employerBps: 30 });
  });

  it("JKK kelas I–V naik monoton sampai 1,74%", () => {
    const v = Object.values(BPJS_TK.jkkClassBps);
    expect(v).toEqual([24, 54, 96, 126, 174]);
  });
});

describe("Overtime", () => {
  it("hari kerja biasa: jam 1 = 1,5x, jam 2+ = 2x", () => {
    expect(OVERTIME.weekdayHourBps(1)).toBe(150);
    expect(OVERTIME.weekdayHourBps(2)).toBe(200);
    expect(OVERTIME.weekdayHourBps(9)).toBe(200);
  });

  it("hari libur: jam 1–8 = 2x, 9–12 = 3x, 13+ = 4x", () => {
    expect(OVERTIME.restDayHourBps(1)).toBe(200);
    expect(OVERTIME.restDayHourBps(8)).toBe(200);
    expect(OVERTIME.restDayHourBps(9)).toBe(300);
    expect(OVERTIME.restDayHourBps(12)).toBe(300);
    expect(OVERTIME.restDayHourBps(13)).toBe(400);
    expect(OVERTIME.restDayHourBps(20)).toBe(400);
  });

  it("menolak jam lembur <= 0", () => {
    expect(() => OVERTIME.restDayHourBps(0)).toThrow();
  });

  it("pembagi upah/jam = 173", () => {
    expect(OVERTIME.hourlyWageDivisor).toBe(173);
  });
});
