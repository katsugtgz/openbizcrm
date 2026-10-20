/**
 * Worker WhatsApp — script runnable `bun src/lib/whatsapp/worker.ts`.
 * Menguras outbox queued per org dan menandai sent/failed via service.
 * Socket Baileys asli menyusul di proses terpisah: antarmuka sender
 * disuntikkan, default stub selalu sukses (hanya untuk dev).
 * Guarded main: `import` dari kode lain tidak menjalankan loop.
 */
import { listQueuedOutbox, resolveOutbox } from "./service";

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
  console.log(`[wa-worker] drain loop org=${orgId} interval=5s`);
  runWorker(userId, orgId).catch((e) => {
    console.error("[wa-worker] fatal:", e);
    process.exit(1);
  });
}
