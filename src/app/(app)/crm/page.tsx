import { Suspense } from "react";
import Link from "next/link";
import { cn } from "cn";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import {
  getOrCreateDefaultPipeline,
  listCompanies,
  listDeals,
} from "@/lib/repos/crm-repo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DealBoard } from "./deal-board";
import { NewDealDialog } from "./new-deal-dialog";

export const metadata = { title: "CRM" };

async function Board({
  orgId,
  userId,
  companyId,
}: {
  orgId: string;
  userId: string;
  companyId?: string;
}) {
  await requireOrgRole(userId, orgId, "member");
  const companies = await listCompanies(orgId);
  if (companies.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Belum ada perusahaan</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Tambahkan perusahaan di menu Perusahaan sebelum membuat deal.
          </p>
        </CardContent>
      </Card>
    );
  }
  // Pipeline perusahaan terpilih; default perusahaan pertama (urut nama).
  const activeCompanyId =
    companyId && companies.some((c) => c.id === companyId)
      ? companyId
      : companies[0].id;
  const { pipeline, stages } = await getOrCreateDefaultPipeline(
    orgId,
    activeCompanyId,
  );
  const deals = await listDeals(orgId, pipeline.id);
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const boardDeals = deals.map((d) => ({
    ...d,
    companyName: companyName.get(d.companyId) ?? "-",
  }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Perusahaan:</span>
        {companies.map((c) => (
          <Link
            key={c.id}
            href={c.id === activeCompanyId ? "/crm" : `/crm?company=${c.id}`}
            aria-current={c.id === activeCompanyId ? "true" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              c.id === activeCompanyId
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card hover:bg-accent",
            )}
          >
            {c.name}
          </Link>
        ))}
      </div>
      <DealBoard stages={stages} deals={boardDeals} />
      <p className="text-xs text-muted-foreground">
        Seret kartu antar kolom untuk memindahkan tahap. Kolom Close Won hijau,
        Close Lost merah.
      </p>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="min-w-[240px] flex-1 space-y-2 rounded-lg bg-muted/50 p-2"
        >
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  );
}

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const user = await session.getSession();
  if (!user) redirect("/login");
  // WorkOS session IDs -> internal UUIDs before the org-scoped reads.
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids!;
  const sp = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">CRM</h1>
          <p className="text-sm text-muted-foreground">
            Kelola deal perusahaan pada papan pipeline.
          </p>
        </div>
        <Suspense fallback={null}>
          <CompaniesGate orgId={orgId} userId={userId} />
        </Suspense>
      </div>
      <Suspense fallback={<BoardSkeleton />}>
        <Board orgId={orgId} userId={userId} companyId={sp.company} />
      </Suspense>
    </div>
  );
}

async function CompaniesGate({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}) {
  await requireOrgRole(userId, orgId, "member");
  const companies = await listCompanies(orgId);
  return (
    <NewDealDialog
      companies={companies.map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}
