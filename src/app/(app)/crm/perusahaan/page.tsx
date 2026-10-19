import { Suspense } from "react";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { listCompanies, listContacts } from "@/lib/repos/crm-repo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NewCompanyDialog, NewContactDialog } from "./dialogs";

export const metadata = { title: "Perusahaan CRM" };

async function Tables({ orgId, userId }: { orgId: string; userId: string }) {
  await requireOrgRole(userId, orgId, "member");
  const [companies, contacts] = await Promise.all([
    listCompanies(orgId),
    listContacts(orgId),
  ]);
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  // Satu pass, bukan O(companies × contacts) per baris tabel (cubic P3
  // perusahaan:63).
  const contactCount = new Map<string, number>();
  for (const k of contacts) {
    contactCount.set(k.companyId, (contactCount.get(k.companyId) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Daftar Perusahaan</CardTitle>
          <div className="flex gap-2">
            <NewContactDialog
              companies={companies.map((c) => ({ id: c.id, name: c.name }))}
            />
            <NewCompanyDialog />
          </div>
        </CardHeader>
        <CardContent>
          {companies.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Belum ada perusahaan.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Industri</TableHead>
                  <TableHead className="text-right">Jumlah Kontak</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.industry ?? "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {contactCount.get(c.id) ?? 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Kontak</CardTitle>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Belum ada kontak.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Perusahaan</TableHead>
                  <TableHead>Jabatan</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Telepon</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell>{companyName.get(k.companyId) ?? "-"}</TableCell>
                    <TableCell>{k.position ?? "-"}</TableCell>
                    <TableCell>{k.email ?? "-"}</TableCell>
                    <TableCell>{k.phone ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TablesSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-48" />
      </CardHeader>
      <CardContent className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

export default async function PerusahaanPage() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  // WorkOS session IDs -> internal UUIDs (cubic P1 perusahaan:24).
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids!;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Perusahaan &amp; Kontak
        </h1>
        <p className="text-sm text-muted-foreground">
          Master data perusahaan dan kontak CRM.
        </p>
      </div>
      <Suspense fallback={<TablesSkeleton />}>
        <Tables orgId={orgId} userId={userId} />
      </Suspense>
    </div>
  );
}
