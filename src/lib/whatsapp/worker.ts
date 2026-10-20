/**
 * Worker WhatsApp — script runnable `bun src/lib/whatsapp/worker.ts`.
 * Menguras outbox queued per org dan menandai sent/failed via service.
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
import { claimOutbox, listQueuedOutbox, resolveOutbox } from "./service";

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
): Promise<number> {
  const queued = await listQueuedOutbox(orgId);
  let processed = 0;
  for (const row of queued) {
    // Klaim atomik: hanya satu worker yang boleh mengirim baris ini.
    const claimed = await claimOutbox(orgId, row.id);
    if (!claimed) continue; // diambil worker lain / sudah terminal
    let result: { ok: boolean; error?: string };
    try {
      result = await sender(row.phone, row.message);
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    await resolveOutbox(userId, orgId, { id: row.id, ...result });
    processed += 1;
  }
  return processed;
}

/** Loop polling; interval ms. Berhenti via AbortSignal. */
export async function runWorker(
  userId: string,
  orgId: string,
  opts: { intervalMs?: number; signal?: AbortSignal; sender?: WaSender } = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 5_000;
  while (!opts.signal?.aborted) {
    await drainOutbox(userId, orgId, opts.sender);
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
  const orgId = process.env.WORKER_ORG_ID;
  if (!userId || !orgId) {
    console.error(
      "[wa-worker] Set WORKER_USER_ID dan WORKER_ORG_ID (internal UUID, " +
        "bukan id sesi WorkOS).",
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
  console.log(`[wa-worker] drain loop org=${orgId} interval=5s (stub dev)`);
  runWorker(userId, orgId).catch((e) => {
    console.error("[wa-worker] fatal:", e);
    process.exit(1);
  });
}
