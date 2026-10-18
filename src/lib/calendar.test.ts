import { describe, expect, it } from "vitest";
import { monthDays, shiftMonth } from "./calendar";

describe("monthDays", () => {
  it("mulai Senin dan mencakup seluruh hari bulan", () => {
    // Oktober 2026: 1 Okt = Kamis, 31 hari, 5 minggu penuh -> 35 sel.
    const days = monthDays(2026, 10);
    expect(days).toHaveLength(35);
    expect(days[0]).toMatchObject({
      date: "2026-09-28",
      weekday: 0,
      inMonth: false,
    });
    expect(days.find((d) => d.date === "2026-10-01")).toMatchObject({
      weekday: 3,
      inMonth: true,
      weekend: false,
    });
    expect(days.find((d) => d.date === "2026-10-31")).toMatchObject({
      weekday: 5,
      inMonth: true,
      weekend: true,
    });
    const inMonth = days.filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0].date).toBe("2026-10-01");
    expect(inMonth.at(-1)!.date).toBe("2026-10-31");
  });

  it("Februari kabisat: 29 hari", () => {
    const days = monthDays(2028, 2);
    expect(days.filter((d) => d.inMonth)).toHaveLength(29);
  });
});

describe("shiftMonth", () => {
  it("navigasi antar bulan dan tahun", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", 1)).toBe("2026-11");
  });
});
