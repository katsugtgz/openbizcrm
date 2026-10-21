/**
 * Tool AI "ringkasan bulan ini" — pure-ish: query DB langsung (tanpa HTTP)
 * supaya testable tanpa server. Mengambil agregat ringkas org: jumlah deal,
 * kontak, faktur lunas/belum, dan total penjualan bulan berjalan (WIB).
 * Format jawaban teks Indonesia untuk konteks LLM.
 */
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { jakartaDateISO } from "@/lib/attendance/rules";

/** Awal bulan berjalan (WIB) sebagai ISO "YYYY-MM-DD" perbandingan tanggal. */
export function currentMonthStart(date: Date = new Date()): string {
  const today = jakartaDateISO(date);
  return `${today.slice(0, 7)}-01`;
}

/** Awal bulan BERIKUTNYA (WIB) — batas atas eksklusif window bulan ini. */
export function nextMonthStart(periodStart: string): string {
  const [y, m] = periodStart.split("-").map(Number);
  const next =
    m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return next;
}

export interface MonthSummary {
  deals: number;
  contacts: number;
  invoicesPaid: number;
  invoicesUnpaid: number;
  posSalesTotal: number;
  period: string;
}

/** Ringkasan langsung dari DB — dipakai route + test. */
export async function computeThisMonthSummary(
  orgId: string,
  periodStart: string,
): Promise<MonthSummary> {
  const { db } = await import("@/db");
  const { crmDeals, crmContacts, invoices, posSales } =
    await import("@/db/schema");
  // Boundary WIB: 00:00 +07:00 (bukan Z, yang telat 7 jam) — cubic pr9 :68.
  const since = new Date(`${periodStart}T00:00:00.000+07:00`);
  const until = new Date(`${nextMonthStart(periodStart)}T00:00:00.000+07:00`);

  const [[dealsRow], [contactsRow], [paidRow], [posRow]] = await Promise.all([
    db
      .select({ n: count() })
      .from(crmDeals)
      .where(
        and(
          eq(crmDeals.orgId, orgId),
          gte(crmDeals.createdAt, since),
          lt(crmDeals.createdAt, until),
        ),
      ),
    db
      .select({ n: count() })
      .from(crmContacts)
      .where(
        and(
          eq(crmContacts.orgId, orgId),
          gte(crmContacts.createdAt, since),
          lt(crmContacts.createdAt, until),
        ),
      ),
    db
      .select({
        paid: sql<number>`count(*) filter (where ${invoices.status} = 'paid')`,
        unpaid: sql<number>`count(*) filter (where ${invoices.status} in ('sent', 'overdue'))`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.orgId, orgId),
          gte(invoices.createdAt, since),
          lt(invoices.createdAt, until),
        ),
      ),
    db
      .select({ total: sql<number>`coalesce(sum(${posSales.total}), 0)` })
      .from(posSales)
      .where(
        and(
          eq(posSales.orgId, orgId),
          // Tanggal BISNIS, bukan stempel audit (cubic pr10 r2:2206):
          // transaksi backdate masuk bulan bisnisnya.
          gte(posSales.saleDate, periodStart),
          lt(posSales.saleDate, nextMonthStart(periodStart)),
        ),
      ),
  ]);
  return {
    deals: Number(dealsRow?.n ?? 0),
    contacts: Number(contactsRow?.n ?? 0),
    invoicesPaid: Number(paidRow?.paid ?? 0),
    invoicesUnpaid: Number(paidRow?.unpaid ?? 0),
    posSalesTotal: Number(posRow?.total ?? 0),
    period: periodStart,
  };
}

/** Format ringkasan jadi teks konteks LLM. */
export function formatMonthSummary(s: MonthSummary): string {
  const rupiah = new Intl.NumberFormat("id-ID");
  return [
    `Ringkasan bulan berjalan (sejak ${s.period}, WIB):`,
    `- Deal baru: ${s.deals}`,
    `- Kontak baru: ${s.contacts}`,
    `- Faktur lunas: ${s.invoicesPaid}, belum lunas: ${s.invoicesUnpaid}`,
    `- Total penjualan POS: Rp ${rupiah.format(s.posSalesTotal)}`,
  ].join("\n");
}
