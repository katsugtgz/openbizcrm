import { describe, it, expect } from "vitest";
import { computeLineTotals, floorTax } from "./totals";

const MAX = Number.MAX_SAFE_INTEGER;

describe("floorTax (subtotal * taxPct / 100, dibagi pct dulu)", () => {
  it("known answer: 1.000.000 x 11% = 110.000", () => {
    expect(floorTax(1_000_000, 11)).toBe(110_000);
  });

  it("known answer: 150.000 x 10% = 15.000", () => {
    expect(floorTax(150_000, 10)).toBe(15_000);
  });

  it("pembulatan ke bawah: 99 x 10% = 9 (bukan 9.9)", () => {
    expect(floorTax(99, 10)).toBe(9);
  });

  it("taxPct 0 => 0", () => {
    expect(floorTax(123_456, 0)).toBe(0);
  });

  it("MAX_SAFE boundary: subtotal MAX diterima, tanpa overflow", () => {
    expect(floorTax(MAX, 10)).toBe(900_719_925_474_099);
    expect(floorTax(MAX, 0)).toBe(0);
    expect(floorTax(MAX, 100)).toBe(MAX);
  });

  it("oracle BigInt: hasil = floor(s*p/100) eksak untuk semua batas", () => {
    // Kedua bentuk float (naif s*p/100 maupun divide-first (s/100)*p)
    // meleset di titik tertentu — oracle BigInt 29×100% = 29 (divide-first
    // memberi 28), s=MAX p=79 = 7115687411245382 (naif benar, div-first +1).
    const oracle = (s: number, p: number) =>
      Number((BigInt(s) * BigInt(p)) / 100n);
    expect(floorTax(29, 100)).toBe(oracle(29, 100)); // 29, divide-first: 28
    expect(floorTax(58, 50)).toBe(oracle(58, 50)); // 29, divide-first: 28
    expect(floorTax(MAX, 79)).toBe(oracle(MAX, 79)); // 7115687411245382
    expect(floorTax(MAX, 79)).not.toBe(Math.floor((MAX / 100) * 79));
    // sweep kecil eksak terhadap oracle
    for (let s = 0; s <= 2_000; s++) {
      for (const p of [3, 7, 10, 11, 33, 50, 79, 99, 100]) {
        expect(floorTax(s, p)).toBe(oracle(s, p));
      }
    }
  });
});

describe("computeLineTotals", () => {
  it("line total = qty * unitPrice", () => {
    expect(computeLineTotals(3, 15_000)).toEqual({
      lineTotal: 45_000,
      subtotal: 45_000,
      taxAmount: 0,
      total: 45_000,
    });
  });

  it("dengan tax: subtotal + floor tax", () => {
    expect(computeLineTotals(1, 1_000_000, 11)).toEqual({
      lineTotal: 1_000_000,
      subtotal: 1_000_000,
      taxAmount: 110_000,
      total: 1_110_000,
    });
  });

  it("qty 0 / negatif ditolak", () => {
    expect(() => computeLineTotals(0, 100)).toThrow();
    expect(() => computeLineTotals(-1, 100)).toThrow();
  });

  it("float ditolak", () => {
    expect(() => computeLineTotals(1.5, 100)).toThrow();
    expect(() => computeLineTotals(2, 10.5)).toThrow();
  });

  it("overflow qty*price ditolak", () => {
    expect(() => computeLineTotals(3, MAX)).toThrow(/MAX_SAFE/);
  });

  it("boundary: hasil tepat MAX_SAFE diterima, melebihi ditolak", () => {
    expect(computeLineTotals(1, MAX).lineTotal).toBe(MAX);
    // 2 * (MAX-1)/2 bulat aman; 2 * (MAX/2 + 1) = MAX+1 melebihi batas.
    const halfPlusOne = 4_503_599_627_370_496; // MAX/2 + 1
    expect(computeLineTotals(1, halfPlusOne).lineTotal).toBe(halfPlusOne);
    expect(() => computeLineTotals(2, halfPlusOne)).toThrow(/MAX_SAFE/);
  });
});
