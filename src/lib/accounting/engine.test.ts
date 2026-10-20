import { describe, it, expect } from "vitest";
import {
  accountBalance,
  assertISODate,
  sumExact,
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
    // /50/ juga cocok dgn suffix "150" — assertion eksplisit (cubic pr8 eng:35).
    expect(errors[0]).toMatch(/selisih 50\)/);
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
    // Fixture seimbang dgn SALES credit 100: tanpa baris CASH pasangan, test
    // tetap hijau walau rule zero-line hilang (cubic pr8 eng:41).
    const errors = validateEntry([
      { accountCode: "1-1000", debit: 0, credit: 0 },
      { accountCode: "1-1000", debit: 100, credit: 0 },
      SALES,
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/tidak boleh 0 di kedua sisi/);
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
    // Baris per-line valid (satu baris MAX lolos per-line check); overflow
    // dari AKUMULASI lintas baris — MAX + 100 > 2^53 (cubic pr8 eng:78).
    const MAX = Number.MAX_SAFE_INTEGER;
    const errors = validateEntry([
      { accountCode: "1-1000", debit: MAX, credit: 0 },
      { accountCode: "1-1000", debit: 100, credit: 0 },
      { accountCode: "3-1000", debit: 0, credit: MAX },
      { accountCode: "3-1000", debit: 0, credit: 100 },
    ]);
    expect(errors.some((e) => e.includes("overflow"))).toBe(true);
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

describe("MAX_LINE_AMOUNT (kolom debit/credit kini bigint — batas JS safe)", () => {
  it("2^31-1 dan di atasnya lolos; MAX_SAFE lolos; MAX_SAFE+1 ditolak", () => {
    expect(
      validateEntry([
        { accountCode: "1-1000", debit: 2_147_483_648, credit: 0 },
        { accountCode: "3-1000", debit: 0, credit: 2_147_483_648 },
      ]),
    ).toEqual([]);
    expect(
      validateEntry([
        { accountCode: "1-1000", debit: Number.MAX_SAFE_INTEGER, credit: 0 },
        {
          accountCode: "3-1000",
          debit: 0,
          credit: Number.MAX_SAFE_INTEGER,
        },
      ]),
    ).toEqual([]);
    const errors = validateEntry([
      { accountCode: "1-1000", debit: 9_007_199_254_740_992, credit: 0 },
      {
        accountCode: "3-1000",
        debit: 0,
        credit: 9_007_199_254_740_992,
      },
    ]);
    expect(errors.some((e) => e.includes("MAX_SAFE"))).toBe(true);
  });
});

describe("BigInt aggregation (cubic pr8 engine:114/:134)", () => {
  const MAXLINE = 2_147_483_647;
  // Sum di atas 2^53 dulu diluar Number.MAX_SAFE? 2^53 = 9.007e15; 3 baris
  // debit 2^31-1 tak cukup. Gunakan akumulasi lintas banyak entri via
  // trialBalance: 4.3M baris tak praktis — cukup buktikan agregat BigInt
  // tepat melewati batas number float.
  it("total melebihi MAX_SAFE_INTEGER: tolak eksplisit, bukan rounding diam-diam", () => {
    const big = 4_503_599_627_370_495; // 2^52-1, per-baris aman
    expect(() =>
      trialBalance(
        [
          [
            { accountCode: "1-1000", debit: big, credit: 0 },
            { accountCode: "1-1000", debit: big, credit: 0 },
            { accountCode: "1-1000", debit: big + 2, credit: 0 },
            { accountCode: "3-1000", debit: 0, credit: big },
            { accountCode: "3-1000", debit: 0, credit: big },
            { accountCode: "3-1000", debit: 0, credit: big + 2 },
          ],
        ],
        TYPES,
      ),
    ).toThrow(/MAX_SAFE/);
  });

  it("agregat di bawah MAX_SAFE: BigInt-presisi tepat", () => {
    const big = 4_503_599_627_370_495; // 2^52-1
    const tb = trialBalance(
      [
        [
          { accountCode: "1-1000", debit: big, credit: 0 },
          { accountCode: "1-1000", debit: big, credit: 0 },
          { accountCode: "3-1000", debit: 0, credit: big },
          { accountCode: "3-1000", debit: 0, credit: big },
        ],
      ],
      TYPES,
    );
    expect(tb.totalDebit).toBe(2 * big);
    expect(tb.balanced).toBe(true);
  });

  it("baris per-line MAX_LINE_AMOUNT (2^31-1) di-total lintas entri tanpa kehilangan presisi", () => {
    const tb = trialBalance(
      [
        [
          { accountCode: "1-1000", debit: MAXLINE, credit: 0 },
          { accountCode: "3-1000", debit: 0, credit: MAXLINE },
        ],
        [
          { accountCode: "1-1000", debit: MAXLINE, credit: 0 },
          { accountCode: "3-1000", debit: 0, credit: MAXLINE },
        ],
        [
          { accountCode: "1-1000", debit: MAXLINE, credit: 0 },
          { accountCode: "3-1000", debit: 0, credit: MAXLINE },
        ],
      ],
      TYPES,
    );
    expect(tb.totalDebit).toBe(3 * MAXLINE);
    expect(tb.balanced).toBe(true);
  });
});

describe("assertISODate", () => {
  it("tanggal valid lolos dan dikembalikan", () => {
    expect(assertISODate("2026-02-28", "Tanggal")).toBe("2026-02-28");
    expect(assertISODate("2024-02-29", "Tanggal")).toBe("2024-02-29");
  });

  it("format non-YYYY-MM-DD ditolak", () => {
    expect(() => assertISODate("2026-2-3", "Tanggal")).toThrow(/YYYY-MM-DD/);
    expect(() => assertISODate("not-a-date", "Tanggal")).toThrow(/YYYY-MM-DD/);
    expect(() => assertISODate("", "Tanggal")).toThrow(/YYYY-MM-DD/);
  });

  it("hari tak nyata ditolak (2026-02-30 lolos Date.parse)", () => {
    expect(Number.isNaN(Date.parse("2026-02-30"))).toBe(false);
    expect(() => assertISODate("2026-02-30", "Tanggal")).toThrow(/kalender/);
    expect(() => assertISODate("2026-13-01", "Tanggal")).toThrow(/kalender/);
    expect(() => assertISODate("2026-04-31", "Tanggal")).toThrow(/kalender/);
  });
});

describe("sumExact (dipakai akumulator service)", () => {
  it("menjumlah tepat", () => {
    expect(sumExact([1, 2, 3])).toBe(6);
    expect(sumExact([])).toBe(0);
    expect(sumExact([10, -4])).toBe(6);
  });

  it("overflow melebihi MAX_SAFE_INTEGER ditolak eksplisit", () => {
    const big = 4_503_599_627_370_495; // 2^52-1
    expect(() => sumExact([big, big, 2])).toThrow(/MAX_SAFE/);
  });
});

describe("unmapped account type (cubic pr8 engine:141)", () => {
  it("accountCode tanpa mapping types ditolak, bukan diam-diam jadi asset", () => {
    expect(() =>
      trialBalance(
        [
          [
            { accountCode: "9-9999", debit: 10, credit: 0 },
            { accountCode: "1-1000", debit: 0, credit: 10 },
          ],
        ],
        TYPES,
      ),
    ).toThrow(/9-9999/);
  });
});
