import { describe, it, expect, vi } from "vitest";

// Pure loop logic test: sender di-mock, resolveOutbox via service butuh DB —
// drainOutbox dipanggil dengan sender stub & service di-mock module-level.
const resolveCalls: { id: string; ok: boolean; error?: string }[] = [];

vi.mock("./service", () => ({
  listQueuedOutbox: vi.fn(async () => [
    { id: "row-1", phone: "+6281", message: "m1" },
    { id: "row-2", phone: "+6282", message: "m2" },
  ]),
  claimOutbox: vi.fn(async () => true),
  resolveOutbox: vi.fn(
    async (
      _u: string,
      _o: string,
      r: { id: string; ok: boolean; error?: string },
    ) => {
      resolveCalls.push(r);
      return null;
    },
  ),
  transitionWhatsappSession: vi.fn(),
}));

import { drainOutbox, stubSender } from "./worker";

describe("worker drain (mocked service)", () => {
  it("memproses tiap queued dan meneruskan hasil sender", async () => {
    resolveCalls.length = 0;
    const sender = vi
      .fn<typeof stubSender>()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("socket mati"));
    const n = await drainOutbox("user-1", "org-1", sender);
    expect(n).toBe(2);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(resolveCalls).toEqual([
      { id: "row-1", ok: true },
      { id: "row-2", ok: false, error: "socket mati" },
    ]);
  });

  it("stub sender selalu sukses", async () => {
    expect(await stubSender("x", "y")).toEqual({ ok: true });
  });

  // Hardening P1: baris yang gagal diklaim TIDAK dikirim & tidak di-resolve.
  it("baris tidak terklaim (worker lain) dilewati tanpa send/resolve", async () => {
    resolveCalls.length = 0;
    // override mock daftar: hanya row yang terklaim yang diproses
    const { listQueuedOutbox, claimOutbox } = await import("./service");
    vi.mocked(listQueuedOutbox).mockResolvedValueOnce([
      {
        id: "row-1",
        orgId: "org-1",
        phone: "+6281",
        message: "m1",
        status: "queued",
        attempts: 0,
        lastError: null,
        sentAt: null,
        createdAt: new Date(),
      },
      {
        id: "row-2",
        orgId: "org-1",
        phone: "+6282",
        message: "m2",
        status: "queued",
        attempts: 0,
        lastError: null,
        sentAt: null,
        createdAt: new Date(),
      },
    ]);
    vi.mocked(claimOutbox).mockImplementation(
      async (_org: string, rowId: string) => rowId === "row-1",
    );
    const sender = vi.fn<typeof stubSender>().mockResolvedValue({ ok: true });
    const n = await drainOutbox("user-1", "org-1", sender);
    expect(n).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(resolveCalls).toEqual([{ id: "row-1", ok: true }]);
  });
});
