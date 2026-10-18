import { beforeEach, describe, expect, it } from "vitest";
import { SessionFake, setFakeUser } from "@/lib/auth/fake";

/**
 * Tests the fake adapter's public interface only — no internals. Module-level
 * store is reset between tests via the public setFakeUser fixture.
 */
describe("SessionFake", () => {
  beforeEach(() => setFakeUser(null));

  it("returns null when unset", async () => {
    await expect(SessionFake.getSession()).resolves.toBeNull();
  });

  it("returns the session after setFakeUser", async () => {
    const user = {
      id: "user_1",
      email: "budi@example.co.id",
      sessionId: "fake-session",
    };
    setFakeUser(user);
    await expect(SessionFake.getSession()).resolves.toEqual(user);
  });

  it("signOut clears the session", async () => {
    setFakeUser({
      id: "user_2",
      email: "sari@example.co.id",
      sessionId: "fake-session",
    });
    await SessionFake.signOut();
    await expect(SessionFake.getSession()).resolves.toBeNull();
  });

  it("signOut is a no-op when already signed out", async () => {
    await expect(SessionFake.signOut()).resolves.toBeUndefined();
    await expect(SessionFake.getSession()).resolves.toBeNull();
  });
});
