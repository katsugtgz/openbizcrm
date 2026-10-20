import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { driveUsageBytes, listFolder } from "@/lib/drive/service";
import { CloudBrowser } from "./cloud-browser";

export const metadata = { title: "Cloud" };

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
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

  const [entry, used] = await Promise.all([
    listFolder(ids.userId, ids.orgId, folderId ?? null),
    driveUsageBytes(ids.orgId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Cloud</h1>
        <p className="text-sm text-muted-foreground">
          Penyimpanan berkas organisasi ({formatBytes(used)} / 10 GB). Unggahan
          presigned langsung ke R2.
        </p>
      </div>
      <CloudBrowser
        folderId={folderId ?? null}
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
