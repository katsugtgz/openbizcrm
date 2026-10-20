import { describe, expect, it } from "vitest";
import { aggregate360 } from "./aggregate";

// Answers map per assignment (sudah tervalidasi).
const mk = (score: number, extra: Record<string, unknown> = {}) => ({
  skor: score,
  komentar: "ok",
  ...extra,
});

describe("aggregate360", () => {
  it("rata-rata sederhana per reviewee", () => {
    const out = aggregate360([
      { revieweeUserId: "u1", answers: mk(4) },
      { revieweeUserId: "u1", answers: mk(2) },
      { revieweeUserId: "u2", answers: mk(5) },
    ]);
    expect(out.get("u1")).toEqual({ count: 2, average: 3 });
    expect(out.get("u2")).toEqual({ count: 1, average: 5 });
  });

  it("string angka dari jawaban di-koersi", () => {
    const out = aggregate360([
      { revieweeUserId: "u1", answers: { skor: "4" } },
    ]);
    expect(out.get("u1")).toEqual({ count: 1, average: 4 });
  });

  it("jawaban tanpa angka dilewati, bukan dihitung 0", () => {
    const out = aggregate360([
      { revieweeUserId: "u1", answers: { komentar: "tanpa skor" } },
      { revieweeUserId: "u1", answers: mk(3) },
    ]);
    expect(out.get("u1")).toEqual({ count: 1, average: 3 });
  });

  it("multi field angka dirata-rata per baris dulu", () => {
    const out = aggregate360([
      { revieweeUserId: "u1", answers: { skor: 2, tambahan: 4 } },
      { revieweeUserId: "u1", answers: { skor: 4, tambahan: 4 } },
    ]);
    // baris 1: (2+4)/2=3; baris 2: (4+4)/2=4 => avg 3.5
    expect(out.get("u1")).toEqual({ count: 2, average: 3.5 });
  });

  it("optional number kosong, checkbox, boolean, null tidak jadi skor", () => {
    const out = aggregate360([
      {
        revieweeUserId: "u1",
        answers: {
          skor: 4,
          komentar: "x",
          perbaikan: "", // optional textarea kosong -> bukan 0
          setuju: true, // checkbox -> bukan 1
          tambahan: null, // optional number kosong -> bukan 0
          lain: ["a"], // array -> bukan koersi aneh
        },
      },
      { revieweeUserId: "u1", answers: { skor: 2 } },
    ]);
    expect(out.get("u1")).toEqual({ count: 2, average: 3 });
  });

  it("numericKeys: key tak dikenal (fakeScore) diabaikan", () => {
    const keys = new Set(["skor"]);
    const out = aggregate360(
      [
        { revieweeUserId: "u1", answers: { skor: 2, fakeScore: 100 } },
        { revieweeUserId: "u1", answers: { skor: 4, fakeScore: 100 } },
      ],
      keys,
    );
    expect(out.get("u1")).toEqual({ count: 2, average: 3 });
  });

  it("whitespace-only string angka dihitung, kosong tidak", () => {
    const out = aggregate360([
      { revieweeUserId: "u1", answers: { skor: "  4  " } },
      { revieweeUserId: "u1", answers: { skor: "   " } },
    ]);
    expect(out.get("u1")).toEqual({ count: 1, average: 4 });
  });

  it("kosong -> map kosong", () => {
    expect(aggregate360([]).size).toBe(0);
  });
});
