import { Suspense } from "react";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { hasRole, requireOrgRole } from "@/lib/org-scope";
import {
  CRM_LIST_DEFAULT_LIMIT,
  countContactsByCompany,
  listCompanies,
  listContacts,
} from "@/lib/repos/crm-repo";
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
import {
  DeleteRowButton,
  EditCompanyDialog,
  EditContactDialog,
  NewCompanyDialog,
  NewContactDialog,
} from "./dialogs";

export const metadata = { title: "Perusahaan CRM" };

async function Tables({ orgId, userId }: { orgId: string; userId: string }) {
  const { role } = await requireOrgRole(userId, orgId, "member");
  // Probe +1 (cubic pr10 r3:9134/9193): tepat 500 = lengkap.
  const [companyProbe, contactProbe, contactCount] = await Promise.all([
    listCompanies(orgId, CRM_LIST_DEFAULT_LIMIT + 1),
    listContacts(orgId, undefined, CRM_LIST_DEFAULT_LIMIT + 1),
    // Agregat DB tanpa cap (cubic pr10 r3:9060): hitungan tetap benar
    // walau daftar kontak dibatasi 500 baris.
    countContactsByCompany(orgId),
  ]);
  const companiesTruncated = companyProbe.length > CRM_LIST_DEFAULT_LIMIT;
  const contactsTruncated = contactProbe.length > CRM_LIST_DEFAULT_LIMIT;
  const companies = companyProbe.slice(0, CRM_LIST_DEFAULT_LIMIT);
  const contacts = contactProbe.slice(0, CRM_LIST_DEFAULT_LIMIT);
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

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
          {companiesTruncated && (
            <p className="pb-2 text-xs text-muted-foreground">
              Menampilkan 500 perusahaan pertama (batas baca) — paginasi
              menyusul.
            </p>
          )}
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
                  <TableHead className="text-right">Aksi</TableHead>
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
                    <TableCell className="text-right">
                      <span className="flex items-center justify-end gap-2">
                        <EditCompanyDialog
                          company={{
                            id: c.id,
                            name: c.name,
                            industry: c.industry,
                          }}
                        />
                        {hasRole(role, "admin") && (
                          <DeleteRowButton kind="company" id={c.id} />
                        )}
                      </span>
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
          {contactsTruncated && (
            <p className="pb-2 text-xs text-muted-foreground">
              Menampilkan 500 kontak pertama (batas baca) — paginasi menyusul.
            </p>
          )}
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
                  <TableHead className="text-right">Aksi</TableHead>
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
                    <TableCell className="text-right">
                      <span className="flex items-center justify-end gap-2">
                        <EditContactDialog
                          contact={{
                            id: k.id,
                            name: k.name,
                            email: k.email,
                            phone: k.phone,
                            position: k.position,
                          }}
                        />
                        <DeleteRowButton kind="contact" id={k.id} />
                      </span>
                    </TableCell>
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
  // WorkOS session IDs -> internal UUIDs before the org-scoped reads.
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
