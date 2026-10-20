import { describe, it, expect } from "vitest";
import {
  WHATSAPP_TRANSITIONS,
  nextWhatsappStatus,
  isWhatsappTerminalConnected,
} from "./session-state";

describe("whatsapp session state machine (pure)", () => {
  it("maju: disconnected -> qr -> connecting -> connected", () => {
    expect(nextWhatsappStatus("disconnected", "qr")).toBe("qr");
    expect(nextWhatsappStatus("qr", "connecting")).toBe("connecting");
    expect(nextWhatsappStatus("connecting", "connected")).toBe("connected");
  });

  it("putus ulang: disconnected <- dari status mana pun", () => {
    expect(nextWhatsappStatus("qr", "disconnected")).toBe("disconnected");
    expect(nextWhatsappStatus("connecting", "disconnected")).toBe(
      "disconnected",
    );
    expect(nextWhatsappStatus("connected", "disconnected")).toBe(
      "disconnected",
    );
    expect(nextWhatsappStatus("disconnected", "disconnected")).toBe(
      "disconnected",
    );
  });

  it("lompatan tidak valid melempar", () => {
    expect(() => nextWhatsappStatus("disconnected", "connected")).toThrow();
    expect(() => nextWhatsappStatus("disconnected", "connecting")).toThrow();
    expect(() => nextWhatsappStatus("qr", "connected")).toThrow();
    expect(() => nextWhatsappStatus("connected", "qr")).toThrow();
    expect(() => nextWhatsappStatus("connecting", "qr")).toThrow();
  });

  it("transisi invalid-status tetap melempar (bukan diam-diam ok)", () => {
    expect(() =>
      // @ts-expect-error invalid enum member at runtime boundary
      nextWhatsappStatus("connected", "broken"),
    ).toThrow();
  });

  it("tabel transisi eksplisit & lengkap", () => {
    expect(WHATSAPP_TRANSITIONS.get("disconnected")).toEqual([
      "qr",
      "disconnected",
    ]);
    expect(isWhatsappTerminalConnected("connected")).toBe(true);
    expect(isWhatsappTerminalConnected("connecting")).toBe(false);
  });
});
