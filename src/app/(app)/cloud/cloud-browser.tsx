"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  confirmUploadAction,
  createFolderAction,
  deleteFileAction,
  presignUploadAction,
} from "./actions";

export interface FolderRow {
  id: string;
  name: string;
}
export interface FileRow {
  id: string;
  fileName: string;
  mimeType: string;
  size: string;
  uploadedAt: string;
}

/**
 * Browser drive: unggah dua tahap — presign server action memberi PUT URL,
 * klien fetch PUT langsung ke R2, lalu confirmUpload memverifikasi objek.
 * R2 belum dikonfigurasi => pesan setup dari ConfigError lewat toast.
 */
export function CloudBrowser({
  folderId,
  parentFolderId,
  folders,
  files,
}: {
  folderId: string | null;
  /** Induk folder aktif (null saat folder aktif = root atau tanpa induk). */
  parentFolderId?: string | null;
  folders: FolderRow[];
  files: FileRow[];
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = fileInputRef.current;
    const file = input?.files?.[0];
    if (!input || !file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("fileName", file.name);
      fd.set("mimeType", file.type || "application/octet-stream");
      fd.set("sizeBytes", String(file.size));
      if (folderId) fd.set("folderId", folderId);
      const result = await presignUploadAction(fd);
      if (!result.ok || !result.uploadUrl || !result.fileId) {
        toast.error(result.error ?? "Gagal menyiapkan unggahan.");
        return;
      }
      const put = await fetch(result.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!put.ok) {
        toast.error(`Unggahan ke storage gagal (HTTP ${put.status}).`);
        return;
      }
      const cfd = new FormData();
      cfd.set("fileId", result.fileId);
      const confirmed = await confirmUploadAction(cfd);
      if (!confirmed.ok) {
        toast.error(confirmed.error ?? "Verifikasi unggahan gagal.");
        return;
      }
      toast.success("Berkas terunggah.");
      input.value = "";
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  function createFolder(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (folderId) fd.set("parentId", folderId);
    e.currentTarget.reset();
    startTransition(async () => {
      const result = await createFolderAction(fd);
      if (result.ok) {
        toast.success("Folder dibuat.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  function remove(fileId: string) {
    const fd = new FormData();
    fd.set("fileId", fileId);
    startTransition(async () => {
      const result = await deleteFileAction(fd);
      if (result.ok) {
        toast.success("Berkas dihapus.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={upload} className="space-y-2 rounded-md border p-4">
          <Label htmlFor="cloud-file">Unggah Berkas</Label>
          <Input
            id="cloud-file"
            ref={fileInputRef}
            type="file"
            required
            aria-label="Pilih berkas untuk diunggah"
          />
          <Button type="submit" size="sm" disabled={uploading}>
            {uploading ? "Mengunggah…" : "Unggah"}
          </Button>
        </form>
        <form
          onSubmit={createFolder}
          className="space-y-2 rounded-md border p-4"
        >
          <Label htmlFor="cloud-folder">Folder Baru</Label>
          <Input
            id="cloud-folder"
            name="name"
            placeholder="Nama folder"
            required
          />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Menyimpan…" : "Buat Folder"}
          </Button>
        </form>
      </div>
      <div className="space-y-1" role="list" aria-label="Isi folder">
        {folderId && (
          // Naik satu tingkat ke induk (cubic cloud-browser.tsx:155),
          // bukan langsung root.
          <Link
            href={parentFolderId ? `/cloud?f=${parentFolderId}` : "/cloud"}
            className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
          >
            ← Folder induk
          </Link>
        )}
        {folders.map((d) => (
          <Link
            key={d.id}
            role="listitem"
            href={`/cloud?f=${d.id}`}
            className="block rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            📁 {d.name}
          </Link>
        ))}
        {files.map((f) => (
          <div
            key={f.id}
            role="listitem"
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{f.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {f.mimeType} · {f.size} · {f.uploadedAt}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => remove(f.id)}
              aria-label={`Hapus ${f.fileName}`}
            >
              Hapus
            </Button>
          </div>
        ))}
        {folders.length === 0 && files.length === 0 && (
          <p className="text-sm text-muted-foreground">Folder kosong.</p>
        )}
      </div>
    </div>
  );
}
