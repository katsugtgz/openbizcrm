import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock namespace ably: hanya Rest tersedia — kode yang memanggil Realtime
// akan TypeError (uji diskriminatif untuk P2 one-shot publisher).
const publish = vi.fn(async () => {});
const get = vi.fn(() => ({ publish }));
const Rest = vi.fn(function (this: unknown) {
  return { channels: { get } };
});

vi.mock("ably", () => ({ default: { Rest } }));

import { publishChatMessage } from "./realtime";

const event = {
  conversationId: "conv-1",
  orgId: "org-1",
  messageId: "m1",
  userId: "u1",
  body: "halo",
  createdAt: new Date().toISOString(),
};

describe("chat realtime publisher", () => {
  beforeEach(() => {
    process.env.ABLY_API_KEY = "test:key";
    publish.mockClear();
    get.mockClear();
    Rest.mockClear();
  });

  it("publish one-shot via REST ke channel per-percakapan (bukan per-org)", async () => {
    await publishChatMessage(event);
    expect(Rest).toHaveBeenCalledTimes(1);
    // P1: channel scope percakapan — bukan broadcast org-wide.
    expect(get).toHaveBeenCalledWith("chat:conv:conv-1");
    expect(get).not.toHaveBeenCalledWith("chat:org-1");
    expect(publish).toHaveBeenCalledWith(
      "message",
      expect.objectContaining({ messageId: "m1" }),
    );
  });

  it("ABLY_API_KEY kosong -> no-op tanpa throw", async () => {
    const prev = process.env.ABLY_API_KEY;
    delete process.env.ABLY_API_KEY;
    try {
      await expect(publishChatMessage(event)).resolves.toBeUndefined();
      expect(Rest).not.toHaveBeenCalled();
    } finally {
      process.env.ABLY_API_KEY = prev;
    }
  });
});
