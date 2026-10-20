"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import {
  confirmUpload,
  createFolder,
  deleteFile,
  driveUsageBytes,
  listFolder,
  presignUpload,
} from "@/lib/drive/service";

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  /** Presigned PUT URL + fileId saat presign berhasil. */
  uploadUrl?: string;
  fileId?: string;
}

async function requireSession() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) throw new Error("Tidak ada organisasi aktif.");
  return { user, ...ids };
}

function fail(error: unknown): ActionResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Gagal.",
  };
}

export async function presignUploadAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const fileName = String(formData.get("fileName") ?? "");
  const mimeType = String(
    formData.get("mimeType") ?? "application/octet-stream",
  );
  const sizeBytes = Number(formData.get("sizeBytes") ?? "0");
  const folderIdRaw = String(formData.get("folderId") ?? "").trim();
  try {
    const result = await presignUpload(
      userId,
      orgId,
      fileName,
      mimeType,
      sizeBytes,
      folderIdRaw || null,
    );
    revalidatePath("/cloud");
    return { ok: true, uploadUrl: result.uploadUrl, fileId: result.fileId };
  } catch (error) {
    return fail(error);
  }
}

export async function createFolderAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const name = String(formData.get("name") ?? "");
  const parentIdRaw = String(formData.get("parentId") ?? "").trim();
  try {
    await createFolder(userId, orgId, name, parentIdRaw || null);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/cloud");
  return { ok: true };
}

export async function deleteFileAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const fileId = String(formData.get("fileId") ?? "").trim();
  try {
    await deleteFile(userId, orgId, fileId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/cloud");
  return { ok: true };
}

export async function driveUsageAction(): Promise<number> {
  const { orgId } = await requireSession();
  return driveUsageBytes(orgId);
}

/** Klien selesai PUT presigned -> verifikasi objek ada di R2. */
export async function confirmUploadAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const fileId = String(formData.get("fileId") ?? "").trim();
  try {
    await confirmUpload(userId, orgId, fileId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/cloud");
  return { ok: true, message: "Unggahan tersimpan." };
}

/** Bacaan isi folder (server action untuk refresh klien setelah unggah). */
export async function listFolderAction(folderId?: string | null) {
  const { userId, orgId } = await requireSession();
  return listFolder(userId, orgId, folderId ?? null);
}
