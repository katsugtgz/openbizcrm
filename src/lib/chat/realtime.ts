/**
 * Realtime publisher untuk chat (Ably REST, one-shot per pesan).
 *
 * Kredensial tidak tersedia di lokal: ABLY_API_KEY kosong -> no-op dengan
 * console.warn sekali (pola fake-adapter auth). Chat tetap berfungsi penuh;
 * realtime hanya enhansa. Konfigurasi produksi: set ABLY_API_KEY.
 *
 * Scope channel per-percakapan (chat:conv:<id>), bukan per-org: publikasi
 * hanya terlihat subscriber yang diotorisasi Ably untuk channel percakapan
 * itu (membership di-enforce saat penerbitan token, bukan filter klien).
 */

let warned = false;

/**
 * Satu REST client per proses — cache PROMISE-nya (bukan hasil): dua publish
 * konkuren pertama berbagi satu init. Tanpa ini dua Rest client dibuat dan
 * satu bocor; tanpa cache sama sekali tiap pesan membuat client baru.
 */
let clientPromise: Promise<import("ably").Rest | null> | undefined;

/** Batas tunggu satu publish Ably — outage tidak boleh menumpuk promise. */
export const PUBLISH_TIMEOUT_MS = 10_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`publish timeout setelah ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ChatRealtimeEvent {
  conversationId: string;
  orgId: string;
  messageId: string;
  userId: string;
  body: string;
  createdAt: string;
}

async function initClient(): Promise<import("ably").Rest | null> {
  const key = process.env.ABLY_API_KEY;
  if (!key) {
    if (!warned) {
      warned = true;
      console.warn(
        "[realtime] ABLY_API_KEY tidak diset — realtime chat dinonaktifkan (pesan tetap tersimpan).",
      );
    }
    return null;
  }
  const Ably = (await import("ably")).default;
  return new Ably.Rest(key);
}

async function getClient(): Promise<import("ably").Rest | null> {
  if (!clientPromise) {
    clientPromise = initClient().catch((e) => {
      clientPromise = undefined; // gagal init boleh dicoba lagi
      throw e;
    });
  }
  return clientPromise;
}

/** Publish pesan baru ke channel per-percakapan. Gagal publish tidak pernah gagalkan pesan. */
export async function publishChatMessage(
  event: ChatRealtimeEvent,
  timeoutMs = PUBLISH_TIMEOUT_MS,
): Promise<void> {
  try {
    const client = await getClient();
    if (!client) return;
    const channel = client.channels.get(`chat:conv:${event.conversationId}`);
    await withTimeout(channel.publish("message", event), timeoutMs);
  } catch (e) {
    console.warn("[realtime] publish gagal (pesan tetap tersimpan):", e);
  }
}
