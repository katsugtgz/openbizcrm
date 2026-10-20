/**
 * Mesin status sesi WhatsApp — MURNI (tanpa DB/IO). Socket Baileys asli
 * berjalan di proses terpisah (di luar scope); service menulis baris status
 * + outbox, worker menguras outbox.
 *
 * Graf transisi:
 *   disconnected -> qr -> connecting -> connected
 *   disconnected <- dari status mana pun (socket putus / logout / error)
 * Transisi lain (lompatan maju/silang) melempar InvalidTransitionError.
 */

export type WhatsappStatus = "disconnected" | "qr" | "connecting" | "connected";

export class InvalidWhatsappTransitionError extends Error {
  constructor(from: WhatsappStatus, to: WhatsappStatus) {
    super(
      `Transisi WhatsApp tidak valid: ${from} -> ${to}. ` +
        "Path yang sah: disconnected -> qr -> connecting -> connected; " +
        "disconnected dapat dari status mana pun.",
    );
    this.name = "InvalidWhatsappTransitionError";
  }
}

/** from -> daftar status tujuan yang sah (deklaratif; sumber kebenaran uji). */
export const WHATSAPP_TRANSITIONS = new Map<WhatsappStatus, WhatsappStatus[]>([
  ["disconnected", ["qr", "disconnected"]],
  ["qr", ["connecting", "disconnected"]],
  ["connecting", ["connected", "disconnected"]],
  ["connected", ["disconnected"]],
]);

export function canTransition(
  from: WhatsappStatus,
  to: WhatsappStatus,
): boolean {
  return (WHATSAPP_TRANSITIONS.get(from) ?? []).includes(to);
}

export function nextWhatsappStatus(
  from: WhatsappStatus,
  to: WhatsappStatus,
): WhatsappStatus {
  if (!canTransition(from, to)) {
    throw new InvalidWhatsappTransitionError(from, to);
  }
  return to;
}

export function isWhatsappTerminalConnected(s: WhatsappStatus): boolean {
  return s === "connected";
}
