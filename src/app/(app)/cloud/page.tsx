import { notFound, redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { driveFolders } from "@/db/schema";
import { driveUsageBytes, listFolder } from "@/lib/drive/service";
import { CloudBrowser } from "./cloud-browser";

export const metadata = { title: "Cloud" };

/** Canonical UUID shape as accepted by PG uuid columns (mirrors guards isUuid). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatBytes(n: number): string {
  // Basis 1024 (cubic cloud/page.tsx:10) — kuota di-enforce biner (10 GiB),
  // tampilan harus pakai unit yang sama.
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GiB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KiB`;
  return `${n} B`;
}

export default async function CloudPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  await requireOrgRole(ids.userId, ids.orgId, "member");
  const { f: folderId } = await searchParams;
  if (folderId && !UUID_RE.test(folderId)) notFound();

  const [entry, used, parent] = await Promise.all([
    listFolder(ids.userId, ids.orgId, folderId ?? null),
    driveUsageBytes(ids.orgId),
    // Induk folder saat ini (cubic cloud-browser.tsx:155) — link "Folder
    // induk" naik satu tingkat, bukan langsung ke root.
    folderId
      ? db
          .select({ parentId: driveFolders.parentId })
          .from(driveFolders)
          .where(
            and(
              eq(driveFolders.id, folderId),
              eq(driveFolders.orgId, ids.orgId),
            ),
          )
          .limit(1)
          .then((r) => r[0]?.parentId ?? null)
      : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Cloud</h1>
        <p className="text-sm text-muted-foreground">
          Penyimpanan berkas organisasi ({formatBytes(used)} / 10 GiB). Unggahan
          presigned langsung ke R2.
        </p>
      </div>
      <CloudBrowser
        folderId={folderId ?? null}
        parentFolderId={parent}
        folders={entry.folders.map((d) => ({ id: d.id, name: d.name }))}
        files={entry.files.map((f) => ({
          id: f.id,
          fileName: f.fileName,
          mimeType: f.mimeType,
          size: formatBytes(f.sizeBytes),
          uploadedAt:
            new Date(f.createdAt.getTime() + 7 * 60 * 60_000)
              .toISOString()
              .slice(0, 16)
              .replace("T", " ") + " WIB",
        }))}
      />
    </div>
  );
}
