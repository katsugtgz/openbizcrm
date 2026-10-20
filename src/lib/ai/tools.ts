/**
 * Tool AI "ringkasan bulan ini" — pure-ish: terima fetcher (default global
 * fetch) supaya testable tanpa server. Mengambil agregat ringkas org:
 * jumlah deal, kontak, faktur lunas/belum, dan total penjualan bulan berjalan
 * (WIB). Format jawaban teks Indonesia untuk konteks LLM.
 */
import { and, count, eq, gte, sql } from "drizzle-orm";
import { jakartaDateISO } from "@/lib/attendance/rules";

/** Awal bulan berjalan (WIB) sebagai ISO "YYYY-MM-DD" perbandingan tanggal. */
export function currentMonthStart(date: Date = new Date()): string {
  const today = jakartaDateISO(date);
  return `${today.slice(0, 7)}-01`;
}

export type MonthFetcher = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

export interface MonthSummary {
  deals: number;
  contacts: number;
  invoicesPaid: number;
  invoicesUnpaid: number;
  posSalesTotal: number;
  period: string;
}

export class AiToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiToolError";
  }
}

/** Ambil ringkasan bulan berjalan dari API internal org (header x-org-id). */
export async function fetchThisMonthSummary(
  orgId: string,
  fetcher: MonthFetcher = fetch,
  baseUrl?: string,
): Promise<MonthSummary> {
  const url = new URL(
    (baseUrl ??
      process.env.NEXT_PUBLIC_APP_URL ??
      `http://localhost:${process.env.PORT ?? 3000}`) + `/api/ai/this-month`,
  );
  url.searchParams.set("period", currentMonthStart());
  const res = await fetcher(url.toString(), {
    headers: { "x-org-id": orgId },
  });
  if (!res.ok) {
    throw new AiToolError(
      `Gagal mengambil ringkasan bulan ini: HTTP ${res.status}.`,
    );
  }
  return (await res.json()) as MonthSummary;
}

/** Ringkasan langsung dari DB (tanpa HTTP) — dipakai route + test. */
export async function computeThisMonthSummary(
  orgId: string,
  periodStart: string,
): Promise<MonthSummary> {
  const { db } = await import("@/db");
  const { crmDeals, crmContacts, invoices, posSales } =
    await import("@/db/schema");
  const since = new Date(`${periodStart}T00:00:00.000Z`);

  const [[dealsRow], [contactsRow], [paidRow], [posRow]] = await Promise.all([
    db
      .select({ n: count() })
      .from(crmDeals)
      .where(and(eq(crmDeals.orgId, orgId), gte(crmDeals.createdAt, since))),
    db
      .select({ n: count() })
      .from(crmContacts)
      .where(
        and(eq(crmContacts.orgId, orgId), gte(crmContacts.createdAt, since)),
      ),
    db
      .select({
        paid: sql<number>`count(*) filter (where ${invoices.status} = 'paid')`,
        unpaid: sql<number>`count(*) filter (where ${invoices.status} <> 'paid')`,
      })
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), gte(invoices.createdAt, since))),
    db
      .select({ total: sql<number>`coalesce(sum(${posSales.total}), 0)` })
      .from(posSales)
      .where(and(eq(posSales.orgId, orgId), gte(posSales.createdAt, since))),
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
