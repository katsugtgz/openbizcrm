import { Suspense } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users as schemaUsers } from "@/db/schema";
import { session } from "@/lib/auth";
import { getEmployeeByUser } from "@/lib/leave/repo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PresensiForm } from "./presensi-form";
import { MiniCalendar } from "./mini-calendar";

export const metadata = { title: "Presensi" };

async function CalendarSection({
  orgId,
  month,
}: {
  orgId: string;
  month: string;
}) {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const employee = await getEmployeeByUser(user.id, orgId);
  return (
    <MiniCalendar
      orgId={orgId}
      employeeId={employee?.id ?? null}
      month={month}
    />
  );
}

function CalendarSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-44" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-56 w-full" />
      </CardContent>
    </Card>
  );
}

export default async function PresensiPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const [row] = await db
    .select({ orgId: schemaUsers.currentOrgId })
    .from(schemaUsers)
    .where(eq(schemaUsers.id, user.id))
    .limit(1);
  if (!row?.orgId) redirect("/dashboard");
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? "")
    ? sp.m!
    : new Date().toISOString().slice(0, 7);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Presensi</h1>
        <p className="text-sm text-muted-foreground">
          Catat kehadiran dengan lokasi kantor atau Wi-Fi kantor.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hari ini</CardTitle>
          </CardHeader>
          <CardContent>
            <PresensiForm />
          </CardContent>
        </Card>
        <Suspense fallback={<CalendarSkeleton />}>
          <CalendarSection orgId={row.orgId} month={month} />
        </Suspense>
      </div>
    </div>
  );
}
