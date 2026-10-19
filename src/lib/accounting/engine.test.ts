import { describe, it, expect } from "vitest";
import {
  accountBalance,
  trialBalance,
  validateEntry,
  type JournalLineInput,
} from "./engine";

const TYPES = {
  "1-1000": "asset" as const,
  "2-1000": "liability" as const,
  "3-1000": "equity" as const,
  "4-1000": "revenue" as const,
  "5-1000": "expense" as const,
};

const CASH: JournalLineInput = { accountCode: "1-1000", debit: 100, credit: 0 };
const SALES: JournalLineInput = {
  accountCode: "4-1000",
  debit: 0,
  credit: 100,
};

describe("validateEntry", () => {
  it("balanced entry passes", () => {
    expect(validateEntry([CASH, SALES])).toEqual([]);
  });

  it("unbalanced: error memuat selisih eksplisit", () => {
    const errors = validateEntry([
      { accountCode: "1-1000", debit: 150, credit: 0 },
      { accountCode: "4-1000", debit: 0, credit: 100 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/50/);
  });

  it("one-sided line ditolak (debit dan credit sekaligus)", () => {
    const errors = validateEntry([
      { accountCode: "1-1000", debit: 10, credit: 10 },
      SALES,
    ]);
    // Entri juga tak seimbang? tetap seimbang nominal (10=10) — cukup 1 error.
    expect(errors.filter((e) => e.includes("1-1000"))).toHaveLength(1);
  });

  it("zero line diizinkan? tidak — baris nol keduanya ditolak", () => {
    const errors = validateEntry([
      { accountCode: "1-1000", debit: 0, credit: 0 },
      SALES,
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("float ditolak", () => {
    const errors = validateEntry([
      { accountCode: "1-1000", debit: 10.5, credit: 0 },
      { accountCode: "4-1000", debit: 0, credit: 10.5 },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("negatif ditolak", () => {
    const errors = validateEntry([
      { accountCode: "1-1000", debit: -5, credit: 0 },
      { accountCode: "4-1000", debit: 0, credit: -5 },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("MAX_SAFE_INTEGER overflow pada debit+credit terdeteksi", () => {
    const MAX = Number.MAX_SAFE_INTEGER;
    const errors = validateEntry([
      { accountCode: "1-1000", debit: MAX, credit: 0 },
      { accountCode: "2-1000", debit: 1, credit: 0 },
      { accountCode: "3-1000", debit: 0, credit: MAX },
    ]);
    expect(errors.some((e) => e.match(/batas kolom DB|overflow|safe/i))).toBe(
      true,
    );
  });

  it("entry kosong ditolak", () => {
    expect(validateEntry([])).toHaveLength(1);
  });
});

describe("accountBalance", () => {
  it("asset: debit - credit", () => {
    const lines: JournalLineInput[] = [
      { accountCode: "1-1000", debit: 300, credit: 100 },
    ];
    expect(accountBalance(lines, "asset")).toBe(200);
  });

  it("liability/equity/revenue: credit - debit", () => {
    const lines: JournalLineInput[] = [
      { accountCode: "2-1000", debit: 50, credit: 200 },
    ];
    expect(accountBalance(lines, "liability")).toBe(150);
    expect(accountBalance(lines, "equity")).toBe(150);
    expect(accountBalance(lines, "revenue")).toBe(150);
  });

  it("expense: debit - credit", () => {
    const lines: JournalLineInput[] = [
      { accountCode: "5-1000", debit: 80, credit: 30 },
    ];
    expect(accountBalance(lines, "expense")).toBe(50);
  });
});

describe("trialBalance", () => {
  it("known answer: agregasi per akun + cross-foot nol", () => {
    const entries: JournalLineInput[][] = [
      [
        { accountCode: "1-1000", debit: 1000, credit: 0 },
        { accountCode: "4-1000", debit: 0, credit: 1000 },
      ],
      [
        { accountCode: "1-1000", debit: 0, credit: 200 },
        { accountCode: "5-1000", debit: 200, credit: 0 },
      ],
    ];
    const tb = trialBalance(entries, TYPES);
    expect(tb.lines).toHaveLength(3);
    const cash = tb.lines.find((l) => l.accountCode === "1-1000")!;
    expect(cash.debit).toBe(1000);
    expect(cash.credit).toBe(200);
    expect(tb.lines.find((l) => l.accountCode === "4-1000")!.credit).toBe(1000);
    expect(tb.lines.find((l) => l.accountCode === "5-1000")!.debit).toBe(200);
    expect(tb.totalDebit).toBe(1200);
    expect(tb.totalCredit).toBe(1200);
    expect(tb.balanced).toBe(true);
  });

  it("cross-foot identity: total debit = total credit = jumlah semua saldo |normal| utk entri seimbang", () => {
    const entries: JournalLineInput[][] = [
      [
        { accountCode: "1-1000", debit: 700, credit: 0 },
        { accountCode: "2-1000", debit: 0, credit: 300 },
        { accountCode: "3-1000", debit: 0, credit: 400 },
      ],
    ];
    const tb = trialBalance(entries, TYPES);
    expect(tb.totalDebit).toBe(700);
    expect(tb.totalCredit).toBe(700);
    expect(tb.totalDebit - tb.totalCredit).toBe(0);
  });

  it("unbalanced set: balanced false, delta terlihat", () => {
    const tb = trialBalance(
      [
        [
          { accountCode: "1-1000", debit: 100, credit: 0 },
          { accountCode: "4-1000", debit: 0, credit: 90 },
        ],
      ],
      TYPES,
    );
    expect(tb.balanced).toBe(false);
    expect(tb.totalDebit - tb.totalCredit).toBe(10);
  });
});

describe("MAX_LINE_AMOUNT (batas kolom PG integer pada debit/credit)", () => {
  it("baris tepat 2^31-1 lolos, 2^31 ditolak sebelum kena DB", () => {
    const MAXLINE = 2_147_483_647;
    expect(
      validateEntry([
        { accountCode: "1-1000", debit: MAXLINE, credit: 0 },
        { accountCode: "3-1000", debit: 0, credit: MAXLINE },
      ]),
    ).toEqual([]);
    const errors = validateEntry([
      { accountCode: "1-1000", debit: 2_147_483_648, credit: 0 },
      { accountCode: "3-1000", debit: 0, credit: 2_147_483_648 },
    ]);
    expect(errors.some((e) => e.includes("batas kolom DB"))).toBe(true);
  });
});
