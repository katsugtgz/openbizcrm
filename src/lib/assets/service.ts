import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  fixedAssets,
  journalEntries,
  journalLines,
  type FixedAsset,
} from "@/db/schema";
import { NotFoundError, requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";
import { assertSafeAmount } from "@/lib/money";

export class AssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetError";
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** "YYYY-MM" dari tanggal ISO. */
function periodOf(dateISO: string): string {
  return dateISO.slice(0, 7);
}

/**
 * Muat akun milik org lalu wajibkan tipenya: akun beban penyusutan harus
 * "expense", akun akumulasi penyusutan harus "asset", dan keduanya harus
 * akun berbeda. Mencegah posting depresiasi terklasifikasi salah.
 */
async function requireDepreciationAccounts(
  orgId: string,
  expenseAccountId: string,
  accumulatedAccountId: string,
  exec: Tx | typeof db = db,
): Promise<void> {
  if (expenseAccountId === accumulatedAccountId) {
    throw new AssetError(
      "Akun beban penyusutan dan akun akumulasi penyusutan harus berbeda.",
    );
  }
  const rows = await exec
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(
      and(
        eq(accounts.orgId, orgId),
        sql`${accounts.id} in (${expenseAccountId}, ${accumulatedAccountId})`,
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r.type]));
  if (!byId.has(expenseAccountId) || !byId.has(accumulatedAccountId)) {
    throw new NotFoundError("Akun tidak ditemukan.");
  }
  if (byId.get(expenseAccountId) !== "expense") {
    throw new AssetError("Akun beban penyusutan harus bertipe expense.");
  }
  if (byId.get(accumulatedAccountId) !== "asset") {
    throw new AssetError("Akun akumulasi penyusutan harus bertipe asset.");
  }
}

export interface AddAssetInput {
  name: string;
  cost: number;
  salvageValue?: number;
  usefulLifeMonths: number;
  acquiredDate: string; // "YYYY-MM-DD"
  depreciationExpenseAccountId: string;
  accumulatedDepreciationAccountId: string;
}

/** Tambah aset tetap. Akun depresiasi wajib milik org + tipe benar. */
export async function addAsset(
  userId: string,
  orgId: string,
  input: AddAssetInput,
): Promise<FixedAsset> {
  await requireOrgRole(userId, orgId, "admin"); // struktur keuangan
  if (!input.name.trim()) {
    throw new AssetError("Nama aset wajib diisi.");
  }
  assertSafeAmount(input.cost, "Harga perolehan");
  const salvageValue = input.salvageValue ?? 0;
  assertSafeAmount(salvageValue, "Nilai sisa");
  if (salvageValue > input.cost) {
    throw new AssetError("Nilai sisa tidak boleh melebihi harga perolehan.");
  }
  if (!Number.isInteger(input.usefulLifeMonths) || input.usefulLifeMonths < 1) {
    throw new AssetError("Umur ekonomis minimal 1 bulan.");
  }
  if (input.cost === salvageValue) {
    throw new AssetError("Nilai penyusutan tidak boleh 0 (cost == salvage).");
  }
  await requireDepreciationAccounts(
    orgId,
    input.depreciationExpenseAccountId,
    input.accumulatedDepreciationAccountId,
  );
  const [row] = await db
    .insert(fixedAssets)
    .values({
      orgId,
      name: input.name,
      cost: input.cost,
      salvageValue,
      usefulLifeMonths: input.usefulLifeMonths,
      acquiredDate: input.acquiredDate,
      depreciationExpenseAccountId: input.depreciationExpenseAccountId,
      accumulatedDepreciationAccountId: input.accumulatedDepreciationAccountId,
      createdBy: userId,
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "asset.create",
    entity: "fixed_asset",
    entityId: row.id,
    metadata: { name: row.name, cost: row.cost, life: row.usefulLifeMonths },
  });
  return row;
}

/** Depresiasi bulanan: floor((cost - salvage) / life). */
export function monthlyDepreciation(asset: {
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
}): number {
  return Math.floor((asset.cost - asset.salvageValue) / asset.usefulLifeMonths);
}

/** "2026-03" -> "2026-03-31": hari kalender terakhir bulan periode. */
function lastDayOfMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Jalankan depresiasi bulanan untuk semua aset active sampai periodEnd
 * "YYYY-MM" (inklusif). Advisory lock per org (sama dengan accounting:
 * "acct:<orgId>") diambil di awal transaksi SEBELUM aset dibaca, jadi snapshot
 * selalu terkunci — run konkuren serial, first-caller-wins per bulan
 * (run kedua melihat last_depreciated_period sudah maju dan skip).
 *
 * Semantik penjumlahan: bulan perolehan dihitung. Floor per bulan; seluruh
 * sisa dibulatkan dan diposting pada bulan terakhir umur ekonomis
 * (ke-usefulLifeMonths) — juga menutup kasus depreciable base < life
 * (floor 0 per bulan) sehingga setiap aset pasti habis terdepresiasi tepat
 * di akhir umurnya. Jurnal diposting tanggal hari terakhir bulan periode.
 *
 * Guard periode fiskal: bulan kalender tiap bulan dalam rentang diperiksa
 * terhadap fiscal_periods.closed di dalam transaksi yang sama — periode
 * tertutup memblokir, sama seperti postEntry. Aset fully-depreciated tetap
 * "active" (beda dengan disposal fisik).
 */
export async function runMonthlyDepreciation(
  userId: string,
  orgId: string,
  periodEnd: string, // "YYYY-MM"
): Promise<{ processed: number; totalAmount: number; skipped: number }> {
  await requireOrgRole(userId, orgId, "member");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodEnd)) {
    throw new AssetError("Format periode harus YYYY-MM.");
  }

  let processed = 0;
  let totalAmount = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    // Lock dulu, baca sesudahnya — snapshot tidak bisa basi.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`acct:${orgId}`}))`,
    );
    const assetRows = await tx
      .select()
      .from(fixedAssets)
      .where(
        and(eq(fixedAssets.orgId, orgId), eq(fixedAssets.status, "active")),
      )
      .orderBy(asc(fixedAssets.acquiredDate))
      .for("update");

    for (const asset of assetRows) {
      if (asset.lastDepreciatedPeriod === periodEnd) {
        skipped += 1; // sudah didepresiasikan sampai periodEnd — idempoten
        continue;
      }
      // Bulan berjalan: bulan perolehan dihitung (aset dipakai bulan itu);
      // run berikutnya mulai bulan SETELAH last_depreciated_period.
      const startPeriod =
        asset.lastDepreciatedPeriod ??
        minusOneMonth(periodOf(asset.acquiredDate));
      if (periodEnd <= startPeriod) {
        skipped += 1;
        continue;
      }

      // Periode fiskal: bulan mana pun dalam rentang yang ditutup = blokir,
      // replikasi guard postEntry (depresiasi tidak boleh menyusup ke bulan
      // yang sudah ditutup).
      const monthsToRun = monthsBetweenExclusive(startPeriod, periodEnd);
      // Rentang yang benar-benar diposting: bulan setelah startPeriod s/d periodEnd.
      const closed = await tx.execute(
        sql`SELECT to_char(period_start, 'YYYY-MM') AS period FROM fiscal_periods WHERE org_id = ${orgId} AND closed = true AND period_start > (${startPeriod} || '-01')::date AND period_start <= (${periodEnd} || '-01')::date LIMIT 1`,
      );
      const closedRows =
        Array.isArray(closed) === false && "rows" in closed
          ? closed.rows
          : (closed as unknown as Record<string, unknown>[]);
      if (closedRows.length > 0) {
        throw new AssetError(
          `Periode fiskal ${String((closedRows[0] as { period: string }).period)} sudah ditutup; depresiasi tidak bisa melewatinya.`,
        );
      }

      // Jumlah: floor per bulan kali bulan berjalan; saat periodEnd mencapai
      // (atau melewati) bulan terakhir umur ekonomis, posting seluruh sisa —
      // menutup kasus base < life (monthly 0) dan sisa pembulatan sekaligus.
      const depreciable = asset.cost - asset.salvageValue;
      const monthly = monthlyDepreciation(asset);
      const finalPeriod = addMonths(
        minusOneMonth(periodOf(asset.acquiredDate)),
        asset.usefulLifeMonths,
      );
      const isFinalPeriod = periodEnd >= finalPeriod;
      const amount = isFinalPeriod
        ? depreciable - asset.totalDepreciated // catch-up bulan terakhir
        : monthly * Math.min(monthsToRun, Math.max(0, asset.usefulLifeMonths));
      if (amount <= 0) {
        skipped += 1; // fully depreciated / tidak ada kenaikan bulan ini
        continue;
      }

      // Jurnal posted (satu entri per aset per run, tanggal akhir bulan).
      const entryDate = lastDayOfMonth(periodEnd);
      const [{ nextNum }] = await tx
        .select({
          nextNum: sql<number>`coalesce(max(${journalEntries.entryNumber}), 0) + 1`,
        })
        .from(journalEntries)
        .where(eq(journalEntries.orgId, orgId));
      const [entry] = await tx
        .insert(journalEntries)
        .values({
          orgId,
          entryNumber: nextNum,
          date: entryDate,
          description: `Penyusutan ${asset.name}`,
          status: "posted",
          source: "depreciation",
          postedAt: new Date(),
          createdBy: userId,
        })
        .returning();
      await tx.insert(journalLines).values([
        {
          orgId,
          entryId: entry.id,
          accountId: asset.depreciationExpenseAccountId,
          debit: amount,
          credit: 0,
        },
        {
          orgId,
          entryId: entry.id,
          accountId: asset.accumulatedDepreciationAccountId,
          debit: 0,
          credit: amount,
        },
      ]);

      const newTotal = asset.totalDepreciated + amount;
      // Expected-state: status masih active. Disposal konkuren (yang juga
      // memegang advisory lock yang sama) tidak mungkin terjadi di dalam lock
      // ini; predicate tetap dipertahankan sebagai lapis kedua.
      const [updated] = await tx
        .update(fixedAssets)
        .set({
          totalDepreciated: newTotal,
          lastDepreciatedPeriod: periodEnd,
        })
        .where(
          and(
            eq(fixedAssets.id, asset.id),
            eq(fixedAssets.orgId, orgId),
            eq(fixedAssets.status, "active"), // expected-state
            eq(fixedAssets.totalDepreciated, asset.totalDepreciated),
          ),
        )
        .returning();
      if (!updated) {
        // Baris berubah di bawah kaki kita (mis. disposal) — jangan posting
        // jurnal untuk state basi; hitung skip.
        skipped += 1;
        continue;
      }
      processed += 1;
      totalAmount += amount;
    }
  });

  if (processed > 0) {
    await recordAudit({
      orgId,
      userId,
      action: "asset.depreciation.run",
      entity: "fixed_asset",
      entityId: periodEnd,
      metadata: { processed, totalAmount, skipped },
    });
  }
  return { processed, totalAmount, skipped };
}

/** Jumlah bulan (integer >= 1) dari period a (eksklusif) sampai b (inklusif). */
export function monthsBetweenExclusive(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** "2025-12" + 24 -> "2027-12". */
function addMonths(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** "2026-01" -> "2025-12". */
function minusOneMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Jual/hilangkan aset: status disposed, tanggal disposal dicatat. */
export async function dispose(
  userId: string,
  orgId: string,
  assetId: string,
  disposalDate: string,
): Promise<FixedAsset> {
  await requireOrgRole(userId, orgId, "admin");
  // Serialisasi dengan run depresiasi (lock sama "acct:<orgId>"): disposal
  // tidak bisa menyelinap di antara baca dan tulis run yang sedang berjalan.
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`acct:${orgId}`}))`,
    );
    const [updated] = await tx
      .update(fixedAssets)
      .set({ status: "disposed", disposalDate })
      .where(
        and(
          eq(fixedAssets.id, assetId),
          eq(fixedAssets.orgId, orgId),
          eq(fixedAssets.status, "active"), // expected-state
        ),
      )
      .returning();
    if (!updated)
      throw new NotFoundError("Aset tidak ditemukan / sudah disposed.");
    return updated;
  });
}

export async function listAssets(orgId: string): Promise<FixedAsset[]> {
  return db
    .select()
    .from(fixedAssets)
    .where(eq(fixedAssets.orgId, orgId))
    .orderBy(asc(fixedAssets.acquiredDate));
}
