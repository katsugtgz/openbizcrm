import { describe, it, expect } from "vitest";
import {
  haversineMeters,
  isWithinRadius,
  wifiMatches,
  jakartaMinutes,
  jakartaDateISO,
  isLate,
  isHoliday,
  evaluateCheckIn,
  computeOvertimeMinutes,
  DEFAULT_GRACE_MINUTES,
  DEFAULT_OVERTIME_THRESHOLD_MINUTES,
  DEFAULT_RADIUS_M,
} from "./rules";

// Mon 2026-10-19 02:00 UTC = 09:00 WIB
const NINE_WIB = new Date("2026-10-19T02:00:00.000Z");
const KANTOR = { lat: -6.2, lon: 106.816 };

describe("haversineMeters", () => {
  it("0 untuk titik sama", () => {
    expect(haversineMeters(KANTOR, KANTOR)).toBe(0);
  });

  it("jarak diketahui Jakarta -> Bandung ~115 km", () => {
    const bdg = { lat: -6.914, lon: 107.61 };
    const d = haversineMeters(KANTOR, bdg);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(120_000);
  });
});

describe("isWithinRadius", () => {
  it("tepat di radius => true (boundary inklusif)", () => {
    // 1 derajat lintang ~ 111_194 m
    const oneDegNorth = { lat: KANTOR.lat + 1, lon: KANTOR.lon };
    const r = haversineMeters(KANTOR, oneDegNorth);
    expect(isWithinRadius(KANTOR, oneDegNorth, r)).toBe(true);
    expect(isWithinRadius(KANTOR, oneDegNorth, r - 1)).toBe(false);
  });
});

describe("wifiMatches", () => {
  it("cocok exact + case-insensitive", () => {
    expect(wifiMatches("PTCSI-Office", ["ptcsi-office"])).toBe(true);
    expect(wifiMatches("PTCSI-Office", ["Lain", "PTCSI-Office"])).toBe(true);
  });
  it("null / kosong / tak cocok => false", () => {
    expect(wifiMatches(null, ["PTCSI-Office"])).toBe(false);
    expect(wifiMatches("warung-kopi", ["PTCSI-Office"])).toBe(false);
    expect(wifiMatches("PTCSI-Office", [])).toBe(false);
  });
});

describe("konversi waktu Jakarta", () => {
  it("jakartaMinutes: 09:00 WIB", () => {
    expect(jakartaMinutes(NINE_WIB)).toBe(9 * 60);
  });
  it("jakartaDateISO: tanggal WIB, bukan UTC", () => {
    // 2026-10-19 17:00 UTC = 2026-10-20 00:00 WIB
    expect(jakartaDateISO(new Date("2026-10-19T17:00:00.000Z"))).toBe(
      "2026-10-20",
    );
  });
});

describe("isLate", () => {
  const start = 9 * 60; // 09:00
  it("tepat jam & dalam grace => ontime", () => {
    expect(isLate(start, start, DEFAULT_GRACE_MINUTES)).toBe(false);
    expect(
      isLate(start + DEFAULT_GRACE_MINUTES, start, DEFAULT_GRACE_MINUTES),
    ).toBe(false);
  });
  it("grace + 1 menit => late (boundary)", () => {
    expect(
      isLate(start + DEFAULT_GRACE_MINUTES + 1, start, DEFAULT_GRACE_MINUTES),
    ).toBe(true);
  });
});

describe("isHoliday", () => {
  it("true hanya bila tanggal ada di daftar", () => {
    expect(isHoliday("2026-10-19", ["2026-10-19"])).toBe(true);
    expect(isHoliday("2026-10-19", ["2026-12-25"])).toBe(false);
    expect(isHoliday("2026-10-19", [])).toBe(false);
  });
});

describe("evaluateCheckIn", () => {
  const shift = { startTime: "09:00", endTime: "17:00" };
  const base = {
    now: NINE_WIB,
    shift,
    office: KANTOR,
    gps: KANTOR,
    ssid: null,
    allowedSsids: [] as string[],
    wfh: false,
    holidayDates: [] as string[],
  };

  it("GPS dalam radius + tepat waktu => ontime/gps", () => {
    expect(evaluateCheckIn(base)).toEqual({
      ok: true,
      status: "ontime",
      method: "gps",
    });
  });

  it("terlambat melewati grace => late/gps", () => {
    const result = evaluateCheckIn({
      ...base,
      now: new Date("2026-10-19T02:16:00.000Z"), // 09:16 WIB
    });
    expect(result).toEqual({ ok: true, status: "late", method: "gps" });
  });

  it("GPS di luar radius + Wi-Fi kantor cocok => wifi", () => {
    const result = evaluateCheckIn({
      ...base,
      gps: { lat: KANTOR.lat + 0.01, lon: KANTOR.lon }, // ~1.1 km
      ssid: "PTCSI-Office",
      allowedSsids: ["ptcsi-office"],
    });
    expect(result).toEqual({ ok: true, status: "ontime", method: "wifi" });
  });

  it("GPS di luar radius + Wi-Fi tidak cocok => ditolak", () => {
    const result = evaluateCheckIn({
      ...base,
      gps: { lat: KANTOR.lat + 0.01, lon: KANTOR.lon },
      ssid: "warung-kopi",
      allowedSsids: ["PTCSI-Office"],
    });
    expect(result.ok).toBe(false);
  });

  it("tanpa GPS & tanpa SSID => ditolak", () => {
    const result = evaluateCheckIn({
      ...base,
      gps: null,
      office: null,
      ssid: null,
    });
    expect(result.ok).toBe(false);
  });

  it("WFH disetujui => wfh/manual, abaikan lokasi & waktu", () => {
    const result = evaluateCheckIn({
      ...base,
      wfh: true,
      gps: null,
      office: null,
      now: new Date("2026-10-19T06:00:00.000Z"), // 13:00 WIB, jelas late
    });
    expect(result).toEqual({ ok: true, status: "wfh", method: "manual" });
  });

  it("hari libur => ditolak", () => {
    const result = evaluateCheckIn({
      ...base,
      holidayDates: ["2026-10-19"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("libur");
  });

  it("radius default terpasang", () => {
    expect(DEFAULT_RADIUS_M).toBeGreaterThan(0);
    expect(DEFAULT_OVERTIME_THRESHOLD_MINUTES).toBeGreaterThan(0);
  });
});

describe("computeOvertimeMinutes", () => {
  const endTime = "17:00";
  // 17:00 WIB
  const at17 = new Date("2026-10-19T10:00:00.000Z");
  const threshold = DEFAULT_OVERTIME_THRESHOLD_MINUTES;

  it("checkout hilang => null (missing checkout)", () => {
    expect(computeOvertimeMinutes(null, endTime, threshold)).toBeNull();
  });

  it("pulang tepat / lebih awal => 0", () => {
    expect(computeOvertimeMinutes(at17, endTime, threshold)).toBe(0);
    expect(
      computeOvertimeMinutes(
        new Date("2026-10-19T09:00:00.000Z"),
        endTime,
        threshold,
      ),
    ).toBe(0);
  });

  it("lembur di bawah threshold => 0", () => {
    // pulang 17:45 => 45 menit < 60
    expect(
      computeOvertimeMinutes(
        new Date("2026-10-19T10:45:00.000Z"),
        endTime,
        threshold,
      ),
    ).toBe(0);
  });

  it("tepat threshold => 0, threshold+1 => 1 (boundary)", () => {
    const at18 = new Date("2026-10-19T11:00:00.000Z"); // 18:00 WIB
    expect(computeOvertimeMinutes(at18, endTime, threshold)).toBe(0);
    const at1801 = new Date("2026-10-19T11:01:00.000Z");
    expect(computeOvertimeMinutes(at1801, endTime, threshold)).toBe(1);
  });
});
