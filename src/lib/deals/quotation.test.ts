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
});
