import { Suspense } from "react";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { getEmployeeByUser } from "@/lib/leave/repo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PresensiForm } from "./presensi-form";
import { MiniCalendar } from "./mini-calendar";

export const metadata = { title: "Presensi" };

async function CalendarSection({
  orgId,
  userId,
  month,
}: {
  orgId: string;
  userId: string;
  month: string;
}) {
  const employee = await getEmployeeByUser(userId, orgId);
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
  // WorkOS session IDs -> internal UUIDs, resolved once for the whole page
  // (userId juga dilempar ke CalendarSection, tidak di-resolve ulang).
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
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
          <CalendarSection
            orgId={ids.orgId}
            userId={ids.userId}
            month={month}
          />
        </Suspense>
      </div>
    </div>
  );
}
