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

async function requireAccountInOrg(
  orgId: string,
  accountId: string,
  exec: Tx | typeof db = db,
): Promise<void> {
  const [row] = await exec
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.orgId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError("Akun tidak ditemukan.");
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

/** Tambah aset tetap. Akun depresiasi wajib milik org. */
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
  await requireAccountInOrg(orgId, input.depreciationExpenseAccountId);
  await requireAccountInOrg(orgId, input.accumulatedDepreciationAccountId);
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

/**
 * Jalankan depresiasi bulanan untuk semua aset active sampai periodEnd
 * "YYYY-MM" (inklusif). Idempoten per bulan via last_depreciated_period:
 * aset yang sudah mencapai period tsb dilewati. Jurnal posted langsung:
 * debit Depreciation Expense, credit Accumulated Depreciation.
 * Aset fully-depreciated otomatis terlewat.
 */
export async function runMonthlyDepreciation(
  userId: string,
  orgId: string,
  periodEnd: string, // "YYYY-MM"
): Promise<{ processed: number; totalAmount: number; skipped: number }> {
  await requireOrgRole(userId, orgId, "member");
  if (!/^\d{4}-\d{2}$/.test(periodEnd)) {
    throw new AssetError("Format periode harus YYYY-MM.");
  }
  const assetRows = await db
    .select()
    .from(fixedAssets)
    .where(and(eq(fixedAssets.orgId, orgId), eq(fixedAssets.status, "active")))
    .orderBy(asc(fixedAssets.acquiredDate));

  let processed = 0;
  let totalAmount = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`acct:${orgId}`}))`,
    );
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
      const monthly = monthlyDepreciation(asset);
      if (monthly <= 0) {
        skipped += 1; // fully depreciated (atau rounding habis)
        continue;
      }
      const remaining =
        asset.cost - asset.salvageValue - asset.totalDepreciated;
      if (remaining <= 0) {
        skipped += 1; // fully depreciated
        continue;
      }
      const months = monthsBetweenExclusive(startPeriod, periodEnd);
      let amount = monthly * months;
      if (amount > remaining) amount = remaining; // jangan lewat depreciable base
      if (amount <= 0) {
        skipped += 1;
        continue;
      }

      // Jurnal posted (satu entri per aset per run, tanggal akhir periode).
      const entryDate = `${periodEnd}-28`; // hari terakhir aman utk semua bulan? gunakan tanggal hari-1 bulan berikutnya
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
      const fully = newTotal >= asset.cost - asset.salvageValue;
      await tx
        .update(fixedAssets)
        .set({
          totalDepreciated: newTotal,
          lastDepreciatedPeriod: periodEnd,
          status: fully ? "disposed" : "active", // fully-depreciated == selesai
        })
        .where(
          and(
            eq(fixedAssets.id, asset.id),
            eq(fixedAssets.orgId, orgId),
            eq(fixedAssets.totalDepreciated, asset.totalDepreciated), // expected-state
          ),
        );
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
  const [updated] = await db
    .update(fixedAssets)
    .set({ status: "disposed", disposalDate })
    .where(
      and(
        eq(fixedAssets.id, assetId),
        eq(fixedAssets.orgId, orgId),
        eq(fixedAssets.status, "active"),
      ),
    )
    .returning();
  if (!updated)
    throw new NotFoundError("Aset tidak ditemukan / sudah disposed.");
  await recordAudit({
    orgId,
    userId,
    action: "asset.dispose",
    entity: "fixed_asset",
    entityId: assetId,
    metadata: { disposalDate },
  });
  return updated;
}

export async function listAssets(orgId: string): Promise<FixedAsset[]> {
  return db
    .select()
    .from(fixedAssets)
    .where(eq(fixedAssets.orgId, orgId))
    .orderBy(asc(fixedAssets.acquiredDate));
}
