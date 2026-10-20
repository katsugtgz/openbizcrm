import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import {
  getDeal,
  getCompany,
  listActivities,
  listContacts,
} from "@/lib/repos/crm-repo";
import { listAuditLogsByEntity } from "@/lib/repos/audit-repo";
import { formatIDR } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ActivityForm,
  DealActions,
  DeleteDealButton,
  EditDealForm,
} from "./deal-actions";
import { QUOT_LABEL } from "@/lib/deals/labels";

export const metadata = { title: "Detail Deal" };

const TYPE_LABEL: Record<string, string> = {
  call: "Telepon",
  meeting: "Meeting",
  task: "Tugas",
  note: "Catatan",
};

const STATUS_BADGE: Record<string, string> = {
  open: "bg-yellow-100 text-yellow-800",
  won: "bg-green-100 text-green-800",
  lost: "bg-red-100 text-red-800",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Terbuka",
  won: "Won",
  lost: "Lost",
};

const HISTORY_LABEL: Record<string, string> = {
  "crm.deal.create": "Deal dibuat",
  "crm.deal.update": "Deal diubah",
  "crm.deal.move": "Pindah tahap",
  "crm.deal.won": "Close Won",
  "crm.deal.lost": "Close Lost",
  "crm.deal.quotation_status": "Quotation",
};

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const user = await session.getSession();
  if (!user) redirect("/login");
  // WorkOS session IDs -> internal UUIDs before the org-scoped reads.
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids;
  // Membership guard sebelum membaca deal/company/activities.
  await requireOrgRole(userId, orgId, "member");

  const deal = await getDeal(orgId, dealId);
  if (!deal) notFound();
  const [company, activities, contacts, history] = await Promise.all([
    getCompany(orgId, deal.companyId),
    listActivities(orgId, dealId),
    listContacts(orgId, deal.companyId),
    listAuditLogsByEntity(userId, orgId, "crm_deal", dealId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {deal.title}
            </h1>
            <Badge className={STATUS_BADGE[deal.status] ?? ""}>
              {STATUS_LABEL[deal.status] ?? deal.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {company?.name ?? "-"} &middot;{" "}
            <span className="tabular-nums font-medium">
              {formatIDR(deal.value)}
            </span>{" "}
            · Quotation:{" "}
            {QUOT_LABEL[deal.quotationStatus] ?? deal.quotationStatus}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/crm">Kembali</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Aksi Deal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <DealActions
            dealId={deal.id}
            quotationStatus={deal.quotationStatus}
            status={deal.status}
          />
          <p className="text-xs text-muted-foreground">
            Transisi quotation: Draft → Terkirim → Diterima/Ditolak.
          </p>
          {deal.status === "open" && (
            <>
              <EditDealForm
                deal={{
                  id: deal.id,
                  title: deal.title,
                  value: deal.value,
                  contactId: deal.contactId,
                }}
                contacts={contacts.map((c) => ({ id: c.id, name: c.name }))}
              />
              <DeleteDealButton dealId={deal.id} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada riwayat tercatat.
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map((h) => {
                const meta = (h.metadata ?? {}) as {
                  from?: string;
                  to?: string;
                  value?: number;
                  status?: string;
                };
                const detail =
                  h.action === "crm.deal.quotation_status" && meta.to
                    ? `${QUOT_LABEL[meta.from ?? ""] ?? meta.from ?? "?"} → ${QUOT_LABEL[meta.to] ?? meta.to}${
                        typeof meta.value === "number"
                          ? ` · ${formatIDR(meta.value)}`
                          : ""
                      }`
                    : h.action === "crm.deal.move" && meta.status
                      ? `status: ${STATUS_LABEL[meta.status] ?? meta.status}`
                      : null;
                return (
                  <li
                    key={h.id}
                    className="flex items-baseline justify-between gap-3 rounded-md border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {HISTORY_LABEL[h.action] ?? h.action}
                      </p>
                      {detail && (
                        <p className="text-xs text-muted-foreground">{detail}</p>
                      )}
                    </div>
                    <time
                      dateTime={h.createdAt.toISOString()}
                      className="shrink-0 text-xs text-muted-foreground"
                    >
                      {h.createdAt.toLocaleString("id-ID")}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Aktivitas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ActivityForm dealId={deal.id} />
          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada aktivitas.
            </p>
          ) : (
            <ul className="space-y-2">
              {activities.map((a) => (
                <li key={a.id} className="rounded-md border p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">
                      {TYPE_LABEL[a.type] ?? a.type}
                    </Badge>
                    <time dateTime={a.createdAt.toISOString()}>
                      {a.createdAt.toLocaleString("id-ID")}
                    </time>
                  </div>
                  <p className="mt-1 text-sm">{a.content}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
