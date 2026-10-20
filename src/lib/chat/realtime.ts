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

/** Satu REST client per proses (cubic realtime.ts:32) — tanpa cache, tiap
 * pesan membuat client baru dan koneksi menumpuk di bawah traffic chat. */
let cachedClient: import("ably").Rest | null | undefined;

export interface ChatRealtimeEvent {
  conversationId: string;
  orgId: string;
  messageId: string;
  userId: string;
  body: string;
  createdAt: string;
}

async function getClient(): Promise<import("ably").Rest | null> {
  if (cachedClient !== undefined) return cachedClient;
  const key = process.env.ABLY_API_KEY;
  if (!key) {
    if (!warned) {
      warned = true;
      console.warn(
        "[realtime] ABLY_API_KEY tidak diset — realtime chat dinonaktifkan (pesan tetap tersimpan).",
      );
    }
    cachedClient = null;
    return null;
  }
  const Ably = (await import("ably")).default;
  cachedClient = new Ably.Rest(key);
  return cachedClient;
}

/** Publish pesan baru ke channel per-percakapan. Gagal publish tidak pernah gagalkan pesan. */
export async function publishChatMessage(
  event: ChatRealtimeEvent,
): Promise<void> {
  try {
    const client = await getClient();
    if (!client) return;
    const channel = client.channels.get(`chat:conv:${event.conversationId}`);
    await channel.publish("message", event);
  } catch (e) {
    console.warn("[realtime] publish gagal (pesan tetap tersimpan):", e);
  }
}
