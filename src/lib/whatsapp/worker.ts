/**
 * Worker WhatsApp — script runnable `bun src/lib/whatsapp/worker.ts`.
 * Menguras outbox queued per org (satu atau banyak via WORKER_ORG_IDS) dan
 * menandai sent/failed via service. Retry otomatis sampai batas attempts,
 * reclaim sekali saat start untuk baris `sending` yatim piatu.
 * Socket Baileys asli menyusul di proses terpisah: antarmuka sender
 * disuntikkan, default stub selalu sukses (hanya untuk dev).
 * Guarded main: `import` dari kode lain tidak menjalankan loop.
 *
 * Hardening cubic:
 *  - P1 (:29): tiap baris diklaim atomik (claimOutbox -> status `sending`)
 *    sebelum sender dipanggil. Worker konkuren atau crash sebelum resolve
 *    tidak lagi mengirim pesan yang sama dua kali.
 *  - P0 (:70): guarded main fail-closed di luar development — tanpa sender
 *    nyata disuntikkan, worker tidak boleh start dengan stubSender (stub
 *    menandai semua pesan `sent` tanpa kirim nyata).
 */
import {
  claimOutbox,
  listQueuedOutbox,
  reclaimStuckOutbox,
  resolveOutbox,
} from "./service";

/** Batas tunggu satu pengiriman sebelum dianggap gagal (lalu di-retry). */
export const SENDER_TIMEOUT_MS = 30_000;

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timeout setelah ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type WaSender = (
  phone: string,
  message: string,
) => Promise<{ ok: boolean; error?: string }>;

/** Stub dev: selalu sukses. Baileys asli menggantikan via injeksi. */
export const stubSender: WaSender = async () => ({ ok: true });

/** Satu putaran drain: proses semua queued org, kembalikan jumlah diproses. */
export async function drainOutbox(
  userId: string,
  orgId: string,
  sender: WaSender = stubSender,
  opts: { senderTimeoutMs?: number } = {},
): Promise<number> {
  const queued = await listQueuedOutbox(orgId);
  const timeoutMs = opts.senderTimeoutMs ?? SENDER_TIMEOUT_MS;
  let processed = 0;
  for (const row of queued) {
    try {
      // Klaim atomik: hanya satu worker yang boleh mengirim baris ini.
      const claimed = await claimOutbox(orgId, row.id);
      if (!claimed) continue; // diambil worker lain / sudah terminal
      let result: { ok: boolean; error?: string };
      try {
        result = await withTimeout(
          sender(row.phone, row.message),
          timeoutMs,
          "pengiriman WA",
        );
      } catch (e) {
        result = {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
      await resolveOutbox(userId, orgId, { id: row.id, ...result });
      processed += 1;
    } catch (e) {
      // Satu baris busuk (DB blip saat claim/resolve) tidak boleh
      // menghentikan drain sisanya — putaran berikut mencoba lagi.
      console.error("[wa-worker] baris gagal diproses, lanjut:", {
        rowId: row.id,
        error: e,
      });
    }
  }
  return processed;
}

/**
 * Loop polling; interval ms. Berhenti via AbortSignal. Multi-org: satu
 * proses bisa menguras beberapa org per putaran (WORKER_ORG_IDS).
 */
export async function runWorker(
  userId: string,
  orgId: string | string[],
  opts: {
    intervalMs?: number;
    signal?: AbortSignal;
    sender?: WaSender;
    senderTimeoutMs?: number;
  } = {},
): Promise<void> {
  const orgIds = Array.isArray(orgId) ? orgId : [orgId];
  // Pemulihan crash sekali saat start: baris `sending` yatim piatu.
  for (const id of orgIds) {
    try {
      const n = await reclaimStuckOutbox(id);
      if (n > 0)
        console.log(`[wa-worker] reclaim ${n} baris sending org=${id}`);
    } catch (e) {
      console.error("[wa-worker] reclaim gagal:", e);
    }
  }
  const intervalMs = opts.intervalMs ?? 5_000;
  while (!opts.signal?.aborted) {
    for (const id of orgIds) {
      if (opts.signal?.aborted) break;
      try {
        await drainOutbox(userId, id, opts.sender, {
          senderTimeoutMs: opts.senderTimeoutMs,
        });
      } catch (e) {
        // DB blip transien: catat, lanjut org/putaran berikut — jangan exit.
        console.error("[wa-worker] drain gagal, coba lagi putaran berikut:", e);
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---------------- guarded main ----------------
const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1]!.split(/[\\/]/).pop()!);

if (isMain) {
  const userId = process.env.WORKER_USER_ID;
  const orgIds = (process.env.WORKER_ORG_IDS ?? process.env.WORKER_ORG_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!userId || orgIds.length === 0) {
    console.error(
      "[wa-worker] Set WORKER_USER_ID dan WORKER_ORG_ID (atau " +
        "WORKER_ORG_IDS koma-pisah; internal UUID, bukan id sesi WorkOS).",
    );
    process.exit(1);
  }
  // P0 fail-closed: stub sender hanya sah di development. Di staging/
  // produksi tanpa sender nyata, worker menolak start alih-alih diam-diam
  // menandai semua pesan `sent` tanpa mengirim.
  if (process.env.NODE_ENV !== "development") {
    console.error(
      "[wa-worker] NODE_ENV bukan 'development' dan tidak ada sender nyata " +
        "yang disuntikkan. Set NODE_ENV=development untuk dry-run stub, atau " +
        "suntikkan sender Baileys asli sebelum start worker.",
    );
    process.exit(1);
  }
  console.log(
    `[wa-worker] drain loop org=${orgIds.join(",")} interval=5s (stub dev)`,
  );
  runWorker(userId, orgIds).catch((e) => {
    console.error("[wa-worker] fatal:", e);
    process.exit(1);
  });
}
