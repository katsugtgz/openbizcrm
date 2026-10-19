/**
 * Pure double-entry engine: tidak menyentuh DB. Validasi entri, saldo akun,
 * neraca saldo (trial balance). Semua nominal integer rupiah aman
 * (Number.MAX_SAFE_INTEGER), konsisten dengan src/lib/money.ts.
 */

export class AccountingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingError";
  }
}

export type AccountType =
  "asset" | "liability" | "equity" | "revenue" | "expense";

export interface JournalLineInput {
  /** Kode akun (mis. "1-1000"); service memetakan ke id UUID per org. */
  accountCode: string;
  debit: number;
  credit: number;
}

export interface TrialBalanceLine {
  accountCode: string;
  /** Akumulasi debit semua entri. */
  debit: number;
  /** Akumulasi credit semua entri. */
  credit: number;
  /** Saldo sisi normal: debit-credit utk asset/expense, credit-debit selainnya. */
  balance: number;
  type: AccountType;
}

export interface TrialBalance {
  lines: TrialBalanceLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

const DEBIT_NORMAL: AccountType[] = ["asset", "expense"];

function isSafePositiveInt(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= MAX_LINE_AMOUNT;
}

/** Batas kolom journal_lines.debit/credit (integer PG = 2^31-1). */
export const MAX_LINE_AMOUNT = 2_147_483_647;

/**
 * Validasi satu entri jurnal (draft maupun sebelum posting):
 * - minimal 2 baris
 * - setiap baris tepat satu sisi (debit XOR credit), nilai integer >= 0
 * - total debit == total credit; pesan error memuat selisihnya
 * - penjumlahan aman: melebihi Number.MAX_SAFE_INTEGER => error eksplisit
 * Kembalikan daftar pesan error (kosong = valid) — dipakai TDD & UI form.
 */
export function validateEntry(lines: JournalLineInput[]): string[] {
  const errors: string[] = [];
  if (lines.length < 2) {
    errors.push("Entri jurnal minimal harus 2 baris.");
    return errors;
  }
  for (const l of lines) {
    if (!isSafePositiveInt(l.debit) || !isSafePositiveInt(l.credit)) {
      errors.push(
        `Baris ${l.accountCode}: debit/credit harus bilangan bulat >= 0 dan <= ${MAX_LINE_AMOUNT} (batas kolom DB).`,
      );
      continue;
    }
    if (l.debit === 0 && l.credit === 0) {
      errors.push(`Baris ${l.accountCode}: nilai tidak boleh 0 di kedua sisi.`);
    } else if (l.debit > 0 && l.credit > 0) {
      errors.push(
        `Baris ${l.accountCode}: hanya boleh mengisi satu sisi (debit ATAU credit).`,
      );
    }
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of lines) {
    if (!Number.isInteger(l.debit) || !Number.isInteger(l.credit)) continue;
    const nextDebit = totalDebit + l.debit;
    const nextCredit = totalCredit + l.credit;
    if (nextDebit > Number.MAX_SAFE_INTEGER) {
      errors.push("Total debit melebihi Number.MAX_SAFE_INTEGER (overflow).");
      break;
    }
    if (nextCredit > Number.MAX_SAFE_INTEGER) {
      errors.push("Total credit melebihi Number.MAX_SAFE_INTEGER (overflow).");
      break;
    }
    totalDebit = nextDebit;
    totalCredit = nextCredit;
  }
  if (totalDebit !== totalCredit) {
    const delta = Math.abs(totalDebit - totalCredit);
    errors.push(
      `Entri tidak seimbang: total debit ${totalDebit} != total credit ${totalCredit} (selisih ${delta}).`,
    );
  }
  return errors;
}

/** Saldo sisi normal satu akun: asset/expense = debit-credit; sisanya credit-debit. */
export function accountBalance(
  lines: JournalLineInput[],
  type: AccountType,
): number {
  const normal = DEBIT_NORMAL.includes(type) ? 1 : -1;
  let sum = 0;
  for (const l of lines) {
    sum += normal * (l.debit - l.credit);
  }
  return sum;
}

/** Neraca saldo dari kumpulan entri (masing-masing array baris).
 * `types` memetakan accountCode -> AccountType (dari chart of accounts). */
export function trialBalance(
  entries: JournalLineInput[][],
  types: Record<string, AccountType>,
): TrialBalance {
  const byAccount = new Map<string, { debit: number; credit: number }>();
  let totalDebit = 0;
  let totalCredit = 0;
  for (const entry of entries) {
    for (const l of entry) {
      const cur = byAccount.get(l.accountCode) ?? { debit: 0, credit: 0 };
      cur.debit += l.debit;
      cur.credit += l.credit;
      byAccount.set(l.accountCode, cur);
      totalDebit += l.debit;
      totalCredit += l.credit;
    }
  }
  const lines: TrialBalanceLine[] = [...byAccount.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([accountCode, agg]) => {
      const type: AccountType = types[accountCode] ?? "asset";
      return {
        accountCode,
        debit: agg.debit,
        credit: agg.credit,
        balance: accountBalance(
          [{ accountCode, debit: agg.debit, credit: agg.credit }],
          type,
        ),
        type,
      };
    });
  return {
    lines,
    totalDebit,
    totalCredit,
    balanced: totalDebit === totalCredit,
  };
}
