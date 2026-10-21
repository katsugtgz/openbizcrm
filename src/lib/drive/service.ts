/**
 * Drive service: folder + file S3-compatible (Cloudflare R2).
 *
 * Kontrak hardening: orgId-first, requireOrgRole per mutasi, audit, safe-int
 * ukuran file, kuota per org (sum size_bytes, default 10GB). presignUpload
 * hanya membuat baris + URL PUT presigned — klien yang mengunggah langsung
 * ke R2. Hapus file: admin+ boleh menghapus file milik orang lain.
 * Kredensial R2 tidak tersedia lokal: ConfigError setup dengan pesan jelas.
 */
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { db } from "@/db";
import {
  driveFiles,
  driveFolders,
  type DriveFile,
  type DriveFolder,
} from "@/db/schema";
import { NotFoundError, requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";

export class DriveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriveError";
  }
}

/** Setup error: konfigurasi R2 hilang — bukan bug runtime, pesan setup. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Kuota drive per org: 10 GB (sesuai spesifikasi). */
export const DRIVE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

/** Batas ukuran per file: satu baris tidak boleh mengunci seluruh kuota. */
export const DRIVE_MAX_FILE_BYTES = 1 * 1024 * 1024 * 1024;

/** Tipe konten aktif yang tidak boleh disimpan apa adanya (stored XSS). */
const ACTIVE_CONTENT_MIME_RE =
  /^(text\/html|image\/svg\+xml|application\/xhtml\+xml|text\/xml|application\/xml)\b/i;

interface DriveConfig {
  bucket: string;
  client: S3Client;
}

function requireDriveConfig(): DriveConfig {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new ConfigError(
      "Konfigurasi drive (R2) belum lengkap. Set R2_ACCOUNT_ID, " +
        "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, dan R2_BUCKET di .env " +
        "(endpoint: https://<account>.r2.cloudflarestorage.com, atau " +
        "S3_ENDPOINT untuk backend S3 lain seperti MinIO).",
    );
  }
  return {
    bucket,
    client: new S3Client({
      region: "auto",
      // Backend S3 apa pun (MinIO lokal) via S3_ENDPOINT; default R2.
      // Empty string falls back too (cubic pr10 env:30): copied examples
      // leave S3_ENDPOINT= blank, and ?? would keep the blank endpoint.
      endpoint:
        process.env.S3_ENDPOINT ||
        `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

/**
 * Sanitasi nama file untuk object key: tanpa '..', tanpa awalan '/',
 * tanpa kontrol karakter / pemisah path. Sisanya dipertahankan.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/]+/g, "-") // pemisah path apa pun -> '-'
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\.{2,}/g, ".") // '..' beruntun hilang -> tidak bisa naik direktori
    .replace(/^\.+/, "")
    .trim();
  if (!cleaned || cleaned === "." || cleaned.startsWith("..")) {
    throw new DriveError("Nama file tidak valid.");
  }
  return cleaned.slice(0, 200);
}

/**
 * Validasi + netralisasi MIME: format token/token, panjang wajar, dan tipe
 * konten aktif (html/svg/xml) dipaksa application/octet-stream supaya objek
 * R2 tidak pernah di-render sebagai halaman oleh browser.
 */
export function sanitizeMimeType(mimeType: string): string {
  const mime = mimeType.trim();
  if (!mime) throw new DriveError("Tipe file wajib diisi.");
  if (
    mime.length > 127 ||
    !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(mime)
  ) {
    throw new DriveError("Tipe file tidak valid.");
  }
  if (ACTIVE_CONTENT_MIME_RE.test(mime)) return "application/octet-stream";
  return mime;
}

export interface PresignResult {
  fileId: string;
  uploadUrl: string;
  key: string;
  /**
   * MIME yang ditandatangani pada URL (hasil sanitizeMimeType): klien
   * WAJIB memakainya sebagai header PUT — file.type asli bisa dinormalisasi
   * (html/svg -> octet-stream) dan mismatch menandatangani gagal (cubic
   * pr10 drive:221).
   */
  contentType: string;
  expiresInSeconds: number;
}

const PRESIGN_TTL_SECONDS = 900;

/**
 * Presigned PUT untuk unggah langsung klien -> R2. Key = <orgId>/<uuid>/<nama>.
 * Kuota diperiksa saat presign; baris dibuat "pending" (reservasi kuota)
 * dengan expiresAt — pending kadaluarsa dibersihkan (purgeExpiredPending)
 * saat presign berikutnya, jadi unggahan ditinggal tidak mengunci kuota
 * selamanya. confirmUpload verifikasi objek ada + ukurannya sama, lalu
 * flip ke confirmed.
 */
export async function presignUpload(
  userId: string,
  orgId: string,
  fileName: string,
  mimeType: string,
  sizeBytes: number,
  folderId?: string | null,
): Promise<PresignResult> {
  await requireOrgRole(userId, orgId, "member");
  const { bucket, client } = requireDriveConfig();
  const safeName = sanitizeFileName(fileName);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new DriveError("Ukuran file harus bilangan bulat positif.");
  }
  if (sizeBytes > DRIVE_MAX_FILE_BYTES) {
    throw new DriveError("Ukuran file melebihi batas 1 GB per file.");
  }
  const safeMime = sanitizeMimeType(mimeType);

  if (folderId) {
    const [folder] = await db
      .select({ id: driveFolders.id })
      .from(driveFolders)
      .where(and(eq(driveFolders.id, folderId), eq(driveFolders.orgId, orgId)))
      .limit(1);
    if (!folder) throw new NotFoundError("Folder tidak ditemukan.");
  }

  // Bersihkan reservasi kadaluarsa + objek R2 yatimnya SEBELUM tx kuota
  // (penghapusan objek tak boleh di dalam tx DB).
  await purgeExpiredWithObjects(orgId);
  return db.transaction(async (tx) => {
    // Kunci per org: dua presign konkuren tidak boleh lolos kuota bersama.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`drive:${orgId}`}))`,
    );
    const [{ used }] = await tx
      .select({
        used: sql<number>`coalesce(sum(${driveFiles.sizeBytes}), 0)::bigint`,
      })
      .from(driveFiles)
      .where(eq(driveFiles.orgId, orgId));
    if (Number(used) + sizeBytes > DRIVE_QUOTA_BYTES) {
      throw new DriveError(
        `Kuota drive organisasi penuh (${(Number(used) / 1e9).toFixed(2)} GB / 10 GB).`,
      );
    }
    // Dedupe double-submit: reservasi pending identik (5 menit terakhir)
    // dipakai ulang — tanpa ini double-click mengunci kuota 2x.
    const [existing] = await tx
      .select()
      .from(driveFiles)
      .where(
        and(
          eq(driveFiles.orgId, orgId),
          eq(driveFiles.uploadedBy, userId),
          eq(driveFiles.status, "pending"),
          eq(driveFiles.fileName, safeName),
          eq(driveFiles.sizeBytes, sizeBytes),
          folderId
            ? eq(driveFiles.folderId, folderId)
            : isNull(driveFiles.folderId),
          gt(driveFiles.createdAt, new Date(Date.now() - 5 * 60 * 1000)),
        ),
      )
      .limit(1);
    if (existing) {
      const retryCommand = new PutObjectCommand({
        Bucket: bucket,
        Key: existing.key,
        ContentType: existing.mimeType,
        ContentLength: existing.sizeBytes,
      });
      const retryUrl = await getSignedUrl(client, retryCommand, {
        expiresIn: PRESIGN_TTL_SECONDS,
      });
      return {
        fileId: existing.id,
        uploadUrl: retryUrl,
        key: existing.key,
        contentType: existing.mimeType,
        expiresInSeconds: PRESIGN_TTL_SECONDS,
      };
    }
    const key = `${orgId}/${randomUUID()}/${safeName}`;
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: safeMime,
      ContentLength: sizeBytes,
    });
    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn: PRESIGN_TTL_SECONDS,
    });
    const [file] = await tx
      .insert(driveFiles)
      .values({
        orgId,
        folderId: folderId ?? null,
        key,
        fileName: safeName,
        mimeType: safeMime,
        sizeBytes,
        uploadedBy: userId,
        status: "pending",
        // Kelonggaran 2x TTL presign: klien lambat tetap sempat confirm.
        expiresAt: new Date(Date.now() + PRESIGN_TTL_SECONDS * 2 * 1000),
      })
      .returning();
    await recordAudit(
      {
        orgId,
        userId,
        action: "drive.file.presign",
        entity: "drive_file",
        entityId: file.id,
        metadata: { key, sizeBytes, folderId: folderId ?? null },
      },
      tx,
    );
    return {
      fileId: file.id,
      uploadUrl,
      key,
      contentType: safeMime,
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    };
  });
}

/**
 * Hapus reservasi pending yang kadaluarsa (dipanggil dalam transaksi).
 * Kembalikan object key yang dibebaskan agar pemanggil menghapus objek
 * R2-nya setelah commit (cubic pr10 drive:562).
 */
async function purgeExpiredPending(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orgId: string,
): Promise<string[]> {
  const expired = await tx
    .select({ id: driveFiles.id, key: driveFiles.key })
    .from(driveFiles)
    .where(
      and(
        eq(driveFiles.orgId, orgId),
        eq(driveFiles.status, "pending"),
        sql`${driveFiles.expiresAt} is not null and ${driveFiles.expiresAt} < now()`,
      ),
    );
  if (expired.length === 0) return [];
  await tx.delete(driveFiles).where(
    inArray(
      driveFiles.id,
      expired.map((r) => r.id),
    ),
  );
  return expired.map((r) => r.key);
}

/**
 * Purge reservasi kadaluarsa + objek R2 yatimnya (best-effort, di luar
 * tx DB): tanpa ini unggahan terbengkalai menumpuk di luar kuota.
 */
async function purgeExpiredWithObjects(orgId: string): Promise<void> {
  const keys = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`drive:${orgId}`}))`,
    );
    return purgeExpiredPending(tx, orgId);
  });
  if (keys.length === 0) return;
  try {
    const { bucket, client } = requireDriveConfig();
    await Promise.all(
      keys.map((Key) =>
        client
          .send(new DeleteObjectCommand({ Bucket: bucket, Key }))
          .catch(() => {}),
      ),
    );
  } catch {
    // R2 belum dikonfigurasi / jaringan down: baris sudah dibebaskan,
    // objek yatim menunggu purge berikut.
  }
}

/** Pembersih reservasi kadaluarsa di luar presign (untuk sweeper terjadwal). */
export async function purgeExpiredDrivePending(orgId: string): Promise<void> {
  await purgeExpiredWithObjects(orgId);
}

export async function confirmUpload(
  userId: string,
  orgId: string,
  fileId: string,
): Promise<DriveFile> {
  await requireOrgRole(userId, orgId, "member");
  const { bucket, client } = requireDriveConfig();
  const [file] = await db
    .select()
    .from(driveFiles)
    .where(and(eq(driveFiles.id, fileId), eq(driveFiles.orgId, orgId)))
    .limit(1);
  if (!file) throw new NotFoundError("File tidak ditemukan.");
  if (file.status === "confirmed") return file; // idempoten
  // Verifikasi objek ada DAN ukurannya sama dengan reservasi — kalau beda,
  // kuota enforcement dan tampilan akan berlainan.
  const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const head = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: file.key }),
  );
  if ((head.ContentLength ?? -1) !== file.sizeBytes) {
    // Beda ukuran: buang objek + reservasi; klien unggah ulang.
    await client
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: file.key }))
      .catch(() => {});
    await db
      .delete(driveFiles)
      .where(and(eq(driveFiles.id, file.id), eq(driveFiles.orgId, orgId)));
    throw new DriveError(
      "Ukuran objek tidak sesuai reservasi. Silakan unggah ulang.",
    );
  }
  const [updated] = await db
    .update(driveFiles)
    .set({ status: "confirmed", confirmedAt: new Date(), expiresAt: null })
    .where(and(eq(driveFiles.id, file.id), eq(driveFiles.orgId, orgId)))
    .returning();
  if (!updated) throw new NotFoundError("File tidak ditemukan.");
  // Re-validasi pasca-flip (TOCTOU HEAD): presigned PUT masih berlaku 900 dtk
  // sehingga bytes bisa diganti setelah HEAD pertama. HEAD kedua mempersempit
  // jendela balap ke milidetik; ketidakcocokan pasti membatalkan konfirmasi.
  // (Perbaikan penuh butuh object versioning di bucket — infra, di luar kode.)
  // Fail closed (cubic pr10 drive:333): HEAD di-retry 3x; ketidakcocokan
  // PASTI maupun HEAD yang tetap gagal membatalkan konfirmasi (buang
  // objek + reservasi, klien unggah ulang). Konfirmasi tanpa verifikasi
  // membiarkan overwrite pasca-HEAD lolos.
  let recheck: { ContentLength?: number } | null = null;
  let recheckError: unknown = null;
  for (let attempt = 0; attempt < 3 && !recheck; attempt++) {
    try {
      recheck = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: file.key }),
      );
    } catch (e) {
      recheckError = e; // retry: HEAD non-definitif (jaringan)
    }
  }
  if (!recheck) {
    console.error("[drive] recheck HEAD gagal, konfirmasi dibatalkan:", {
      key: file.key,
      error: recheckError,
    });
  }
  if (!recheck || (recheck.ContentLength ?? -1) !== file.sizeBytes) {
    await client
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: file.key }))
      .catch(() => {});
    await db
      .delete(driveFiles)
      .where(and(eq(driveFiles.id, file.id), eq(driveFiles.orgId, orgId)));
    throw new DriveError(
      "Ukuran objek tidak sesuai reservasi. Silakan unggah ulang.",
    );
  }
  return updated;
}

export async function createFolder(
  userId: string,
  orgId: string,
  name: string,
  parentId?: string | null,
): Promise<DriveFolder> {
  await requireOrgRole(userId, orgId, "member");
  const safeName = sanitizeFileName(name);
  if (parentId) {
    const [parent] = await db
      .select({ id: driveFolders.id })
      .from(driveFolders)
      .where(and(eq(driveFolders.id, parentId), eq(driveFolders.orgId, orgId)))
      .limit(1);
    if (!parent) throw new NotFoundError("Folder induk tidak ditemukan.");
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`drive-folder:${orgId}`}))`,
    );
    // Nama unik per induk (root = parent NULL) — dedupe app-side.
    const [dup] = await tx
      .select({ id: driveFolders.id })
      .from(driveFolders)
      .where(
        and(
          eq(driveFolders.orgId, orgId),
          parentId
            ? eq(driveFolders.parentId, parentId)
            : isNull(driveFolders.parentId),
          eq(driveFolders.name, safeName),
        ),
      )
      .limit(1);
    if (dup) throw new DriveError("Nama folder sudah dipakai di lokasi ini.");
    const [folder] = await tx
      .insert(driveFolders)
      .values({
        orgId,
        parentId: parentId ?? null,
        name: safeName,
        createdBy: userId,
      })
      .returning();
    await recordAudit(
      {
        orgId,
        userId,
        action: "drive.folder.create",
        entity: "drive_folder",
        entityId: folder.id,
        metadata: { name: safeName, parentId: parentId ?? null },
      },
      tx,
    );
    return folder;
  });
}

export interface FolderEntry {
  folders: DriveFolder[];
  files: DriveFile[];
}

export async function listFolder(
  userId: string,
  orgId: string,
  folderId?: string | null,
  limit = 200,
): Promise<FolderEntry> {
  await requireOrgRole(userId, orgId, "member");
  if (folderId) {
    const [folder] = await db
      .select({ id: driveFolders.id })
      .from(driveFolders)
      .where(and(eq(driveFolders.id, folderId), eq(driveFolders.orgId, orgId)))
      .limit(1);
    if (!folder) throw new NotFoundError("Folder tidak ditemukan.");
  }
  const capped = Math.min(Math.max(limit, 1), 1000);
  const [folders, files] = await Promise.all([
    db
      .select()
      .from(driveFolders)
      .where(
        and(
          eq(driveFolders.orgId, orgId),
          folderId
            ? eq(driveFolders.parentId, folderId)
            : isNull(driveFolders.parentId),
        ),
      )
      .orderBy(asc(driveFolders.name))
      .limit(capped),
    db
      .select()
      .from(driveFiles)
      .where(
        and(
          eq(driveFiles.orgId, orgId),
          // Reservasi pending (belum terkonfirmasi) tidak ditampilkan.
          eq(driveFiles.status, "confirmed"),
          folderId
            ? eq(driveFiles.folderId, folderId)
            : isNull(driveFiles.folderId),
        ),
      )
      .orderBy(asc(driveFiles.fileName))
      .limit(capped),
  ]);
  return { folders, files };
}

/** Pohon folder org (breadcrumb / navigasi). */
export async function folderTree(
  userId: string,
  orgId: string,
  limit = 1000,
): Promise<DriveFolder[]> {
  await requireOrgRole(userId, orgId, "member");
  return db
    .select()
    .from(driveFolders)
    .where(eq(driveFolders.orgId, orgId))
    .orderBy(asc(driveFolders.name))
    .limit(Math.min(Math.max(limit, 1), 5000));
}

export async function deleteFile(
  userId: string,
  orgId: string,
  fileId: string,
): Promise<void> {
  await requireOrgRole(userId, orgId, "member");
  const [file] = await db
    .select()
    .from(driveFiles)
    .where(and(eq(driveFiles.id, fileId), eq(driveFiles.orgId, orgId)))
    .limit(1);
  if (!file) throw new NotFoundError("File tidak ditemukan.");
  if (file.uploadedBy !== userId) {
    // Non-pemilik: wajib admin+ (pola konsisten: member hanya file sendiri).
    await requireOrgRole(userId, orgId, "admin");
  }
  const { bucket, client } = requireDriveConfig();
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(driveFiles)
      .where(and(eq(driveFiles.id, fileId), eq(driveFiles.orgId, orgId)))
      .returning();
    if (deleted.length === 0) {
      throw new NotFoundError("File tidak ditemukan.");
    }
    void deleted;
    await recordAudit(
      {
        orgId,
        userId,
        action: "drive.file.delete",
        entity: "drive_file",
        entityId: fileId,
        metadata: { key: file.key, ownerUserId: file.uploadedBy },
      },
      tx,
    );
  });
  // Hapus objek R2 SETELAH baris ter-commit. Gagal R2 tidak dibiarkan jadi
  // orphan sunyi: catat audit "delete.object.failed" berisi key supaya bisa
  // dibersihkan/diulang; user tetap melihat file terhapus (metadata hilang).
  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: file.key }),
    );
  } catch (error) {
    // Audit member-readable hanya menyimpan NAMA error; pesan mentah SDK
    // (bisa memuat detail backend) hanya ke log server.
    console.error("[drive] hapus objek R2 gagal:", { key: file.key, error });
    await recordAudit({
      orgId,
      userId,
      action: "drive.file.delete.object_failed",
      entity: "drive_file",
      entityId: fileId,
      metadata: {
        key: file.key,
        error: error instanceof Error ? error.name || "R2Error" : "UnknownError",
      },
    });
    throw error;
  }
}

export async function driveUsageBytes(orgId: string): Promise<number> {
  // Semua baris dihitung — termasuk pending kadaluarsa yang belum di-purge
  // (cubic pr10 drive:562): objek R2-nya masih ada sampai purge
  // menghapusnya, jadi menguranginya dari kuota menyembunyikan pemakaian.
  const [{ used }] = await db
    .select({
      used: sql<number>`coalesce(sum(${driveFiles.sizeBytes}), 0)::bigint`,
    })
    .from(driveFiles)
    .where(eq(driveFiles.orgId, orgId));
  return Number(used);
}
