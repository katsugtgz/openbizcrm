import { describe, it, expect } from "vitest";
import {
  calculateQuotationTotals,
  type QuotationLine,
} from "@/lib/deals/quotation";
import { MoneyError } from "@/lib/money";

describe("quotation totals", () => {
  it("no discount", () => {
    expect(
      calculateQuotationTotals([
        { description: "Lisensi", quantity: 2, unitPrice: 500_000 },
      ]),
    ).toEqual({ subtotal: 1_000_000, discountTotal: 0, total: 1_000_000 });
  });

  it("line discount", () => {
    expect(
      calculateQuotationTotals([
        {
          description: "Lisensi",
          quantity: 1,
          unitPrice: 1_000_000,
          discountPercent: 10,
        },
      ]),
    ).toEqual({ subtotal: 1_000_000, discountTotal: 100_000, total: 900_000 });
  });

  it("multiple items", () => {
    expect(
      calculateQuotationTotals([
        {
          description: "A",
          quantity: 2,
          unitPrice: 1_000_000,
          discountPercent: 10,
        },
        { description: "B", quantity: 1, unitPrice: 500_000 },
      ]),
    ).toEqual({
      subtotal: 2_500_000,
      discountTotal: 200_000,
      total: 2_300_000,
    });
  });

  it("rounds per-line discount to rupiah", () => {
    expect(
      calculateQuotationTotals([
        { description: "A", quantity: 1, unitPrice: 999, discountPercent: 50 },
      ]),
    ).toEqual({ subtotal: 999, discountTotal: 500, total: 499 });
  });

  it("empty items throws", () => {
    expect(() => calculateQuotationTotals([])).toThrow(MoneyError);
  });

  it("non-integer unit price throws", () => {
    const lines: QuotationLine[] = [
      { description: "A", quantity: 1, unitPrice: 10.5 },
    ];
    expect(() => calculateQuotationTotals(lines)).toThrow(MoneyError);
  });

  it("discount > 100 throws", () => {
    expect(() =>
      calculateQuotationTotals([
        { description: "A", quantity: 1, unitPrice: 100, discountPercent: 101 },
      ]),
    ).toThrow(MoneyError);
  });

  it("safe inputs but unsafe line total throws (cubic P2 quotation:44)", () => {
    const lines: QuotationLine[] = [
      { description: "A", quantity: 4096, unitPrice: Number.MAX_SAFE_INTEGER },
    ];
    expect(() => calculateQuotationTotals(lines)).toThrow(/Total per baris/);
  });

  it("accumulated subtotal overflow throws", () => {
    const unit = 9_000_000_000_000_000; // safe per line, 2 lines overflow
    const lines: QuotationLine[] = [
      { description: "A", quantity: 1, unitPrice: unit },
      { description: "B", quantity: 1, unitPrice: unit },
    ];
    expect(() => calculateQuotationTotals(lines)).toThrow(/Subtotal/);
  });

  it("100% discount near MAX_SAFE_INTEGER stays exact (cubic P2 quotation:52)", () => {
    // lineTotal aman; (lineTotal * pct) versi lama overflow di tengah.
    const near = Number.MAX_SAFE_INTEGER;
    expect(
      calculateQuotationTotals([
        {
          description: "A",
          quantity: 1,
          unitPrice: near,
          discountPercent: 100,
        },
      ]),
    ).toEqual({ subtotal: near, discountTotal: near, total: 0 });
  });

  it("100% discount on MAX_SAFE_INTEGER - 1 loses no rupiah (cubic P2 quotation:55)", () => {
    // Faktor persen dibatasi (pct/100) dulu: 100% = factor 1 exact. Bentuk
    // lama (lineTotal/100)*pct membulatkan 1 rupiah LEBIH besar → total -1.
    const near = Number.MAX_SAFE_INTEGER - 1;
    expect(
      calculateQuotationTotals([
        {
          description: "A",
          quantity: 1,
          unitPrice: near,
          discountPercent: 100,
        },
      ]),
    ).toEqual({ subtotal: near, discountTotal: near, total: 0 });
  });

  it("3.28% at MAX_SAFE_INTEGER discriminates old vs new ordering (cubic P2 quotation.test:91)", () => {
    // Bentuk lama (lineTotal/100)*pct dan baru lineTotal*(pct/100) harus
    // menghasilkan rupiah BERBEDA di kombinasi ini — test gagal melawan
    // implementasi lama, lolos melawan yang baru. (66.67% TIDAK
    // membedakan: kedua bentuk menghasilkan rupiah sama; 3.28% beda 1.)
    const M = Number.MAX_SAFE_INTEGER;
    expect(
      calculateQuotationTotals([
        { description: "A", quantity: 1, unitPrice: M, discountPercent: 3.28 },
      ]),
    ).toEqual({
      subtotal: M,
      discountTotal: 295_436_135_555_504,
      total: M - 295_436_135_555_504,
    });
  });

  it("50% discount on MAX_SAFE_INTEGER - 1 rounds exactly (cubic P2 quotation:55)", () => {
    // near = 4503599627370495 ganjil; exact floor = ...494.75 → 495 (round).
    // Bentuk lama menghasilkan ...496 (1 lebih) karena (x/100)*50 tak exact.
    const near = Number.MAX_SAFE_INTEGER - 1;
    expect(
      calculateQuotationTotals([
        {
          description: "A",
          quantity: 1,
          unitPrice: near,
          discountPercent: 50,
        },
      ]),
    ).toEqual({
      subtotal: near,
      discountTotal: 4_503_599_627_370_495,
      total: near - 4_503_599_627_370_495,
    });
  });
});
