import { describe, it, expect, vi } from "vitest";

// Pure loop logic test: sender di-mock, resolveOutbox via service butuh DB —
// drainOutbox dipanggil dengan sender stub & service di-mock module-level.
const resolveCalls: { id: string; ok: boolean; error?: string }[] = [];

vi.mock("./service", () => ({
  listQueuedOutbox: vi.fn(async () => [
    { id: "row-1", phone: "+6281", message: "m1" },
    { id: "row-2", phone: "+6282", message: "m2" },
  ]),
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
});
