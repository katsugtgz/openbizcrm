import { Suspense } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users as schemaUsers } from "@/db/schema";
import { session } from "@/lib/auth";
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

async function Board({ orgId, userId }: { orgId: string; userId: string }) {
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
  // Pipeline default perusahaan pertama (urut nama) sebagai papan utama.
  const { pipeline, stages } = await getOrCreateDefaultPipeline(
    orgId,
    companies[0].id,
  );
  const deals = await listDeals(orgId, pipeline.id);
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const boardDeals = deals.map((d) => ({
    ...d,
    companyName: companyName.get(d.companyId) ?? "-",
  }));
  return (
    <div className="space-y-4">
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

export default async function CrmPage() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const orgId =
    user.organizationId ??
    (
      await db
        .select({ orgId: schemaUsers.currentOrgId })
        .from(schemaUsers)
        .where(eq(schemaUsers.id, user.id))
        .limit(1)
    )[0]?.orgId;
  if (!orgId) redirect("/dashboard");

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
          <CompaniesGate orgId={orgId} />
        </Suspense>
      </div>
      <Suspense fallback={<BoardSkeleton />}>
        <Board orgId={orgId} userId={user.id} />
      </Suspense>
    </div>
  );
}

async function CompaniesGate({ orgId }: { orgId: string }) {
  const companies = await listCompanies(orgId);
  return (
    <NewDealDialog
      companies={companies.map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}
