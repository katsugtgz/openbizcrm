import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SessionFake, setFakeUser } from "@/lib/auth/fake";
import { FAKE_USERS } from "@/lib/auth/fake-users";

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

/**
 * Adapter pick matrix (src/lib/auth/index.ts). The module caches the picked
 * adapter in a module-level promise, so each matrix case runs in a fresh
 * module registry via importActual reset below (vitest resetModules).
 */
describe("auth adapter pick matrix", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
  });

  /** Re-import the module under a specific env matrix cell. */
  async function pickEnv(env: Record<string, string | undefined>) {
    process.env = { ...saved };
    // True absence: assigning undefined coerces to the string "undefined"
    // (still present and truthy) — delete instead (mirrors config.test.ts).
    delete process.env.AUTH_FAKE;
    delete process.env.WORKOS_API_KEY;
    delete process.env.WORKOS_CLIENT_ID;
    delete process.env.WORKOS_COOKIE_PASSWORD;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
    const mod = await import("@/lib/auth");
    const spied = vi.fn(async () => null);
    // Probe which adapter was picked: SessionFake resolves without WorkOS
    // state; AuthKit would need server-only cookies. We detect via a
    // behaviorally observable seam: fake adapter returns null session
    // without throwing, AuthKit import throws outside Next runtime.
    let pickedFake = false;
    try {
      const s = await mod.session.getSession();
      pickedFake = s === null;
    } catch {
      pickedFake = false;
    }
    void spied;
    return pickedFake;
  }

  it("AUTH_FAKE=1 + non-production -> fake", async () => {
    expect(await pickEnv({ AUTH_FAKE: "1", NODE_ENV: "test" })).toBe(true);
  });

  it("AUTH_FAKE=1 + production -> NOT fake (impersonation guard)", async () => {
    expect(await pickEnv({ AUTH_FAKE: "1", NODE_ENV: "production" })).toBe(
      false,
    );
  });

  it("WorkOS unconfigured -> fake fallback (login page can render)", async () => {
    expect(await pickEnv({ NODE_ENV: "test" })).toBe(true);
  });

  it("absence cells truly delete keys (no \"undefined\" strings)", async () => {
    process.env = { ...saved };
    delete process.env.AUTH_FAKE;
    delete process.env.WORKOS_API_KEY;
    delete process.env.WORKOS_CLIENT_ID;
    delete process.env.WORKOS_COOKIE_PASSWORD;
    // Guard the matrix itself: with true absence the session env is not
    // ready and the picker must serve fake.
    vi.resetModules();
    const { isWorkosSessionEnvReady } = await import("@/lib/auth/config");
    const { fakeSessionActive } = await import("@/lib/auth");
    expect(process.env.AUTH_FAKE).toBeUndefined();
    expect(process.env.WORKOS_API_KEY).toBeUndefined();
    expect(isWorkosSessionEnvReady()).toBe(false);
    expect(fakeSessionActive()).toBe(true);
  });

  it("WorkOS fully configured -> AuthKit", async () => {
    expect(
      await pickEnv({
        NODE_ENV: "test",
        WORKOS_API_KEY: "sk_test_x",
        WORKOS_CLIENT_ID: "client_x",
        WORKOS_COOKIE_PASSWORD: "c".repeat(32),
      }),
    ).toBe(false);
  });

  it("short cookie password -> NOT fake (fail closed, cubic pr10)", async () => {
    expect(
      await pickEnv({
        NODE_ENV: "test",
        WORKOS_API_KEY: "sk_test_x",
        WORKOS_CLIENT_ID: "client_x",
        WORKOS_COOKIE_PASSWORD: "short",
      }),
    ).toBe(false);
  });

  it("partial WorkOS config (no cookie password) -> fake fallback", async () => {
    expect(
      await pickEnv({
        NODE_ENV: "test",
        WORKOS_API_KEY: "sk_test_x",
        WORKOS_CLIENT_ID: "client_x",
      }),
    ).toBe(true);
  });
});

/** Fake sign-in allowlist: only seeded identities resolve. */
describe("FAKE_USERS allowlist", () => {
  it("exposes exactly the three seeded users", () => {
    expect(Object.keys(FAKE_USERS).sort()).toEqual([
      "seed-admin-1",
      "seed-member-1",
      "seed-owner-1",
    ]);
  });

  it("carries the identity fields the session needs", () => {
    for (const user of Object.values(FAKE_USERS)) {
      expect(user.id).toBeTruthy();
      expect(user.email).toContain("@");
    }
  });
});
