/**
 * Realtime publisher untuk chat (Ably).
 *
 * Kredensial tidak tersedia di lokal: ABLY_API_KEY kosong -> no-op dengan
 * console.warn sekali (pola fake-adapter auth). Chat tetap berfungsi penuh;
 * realtime hanya enhansa. Konfigurasi produksi: set ABLY_API_KEY.
 */

let warned = false;

export interface ChatRealtimeEvent {
  conversationId: string;
  orgId: string;
  messageId: string;
  userId: string;
  body: string;
  createdAt: string;
}

async function getClient(): Promise<import("ably").Realtime | null> {
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
  return new Ably.Realtime(key);
}

/** Publish pesan baru ke channel per-org. Gagal publish tidak pernah gagalkan pesan. */
export async function publishChatMessage(
  event: ChatRealtimeEvent,
): Promise<void> {
  try {
    const client = await getClient();
    if (!client) return;
    const channel = client.channels.get(`chat:${event.orgId}`);
    await channel.publish("message", event);
  } catch (e) {
    console.warn("[realtime] publish gagal (pesan tetap tersimpan):", e);
  }
}
