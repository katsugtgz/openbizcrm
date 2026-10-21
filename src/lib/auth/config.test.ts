import { afterEach, describe, expect, it } from "vitest";
import {
  WORKOS_MIN_COOKIE_PASSWORD_LENGTH,
  isWorkosConfigured,
  isWorkosEnvPresent,
  isWorkosSessionEnvReady,
} from "./config";
import { fakeSessionActive } from "./index";

/**
 * Readiness predicates: the login/proxy check (isWorkosConfigured) keeps
 * the length requirement, while the fake-fallback predicate
 * (fakeSessionActive) is presence-only — a short cookie fails closed
 * through AuthKit instead of silently serving forgeable fake sessions
 * (cubic pr10 auth-config:36).
 */
describe("auth readiness predicates", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  function setEnv(env: Record<string, string | undefined>): void {
    delete process.env.AUTH_FAKE;
    delete process.env.WORKOS_API_KEY;
    delete process.env.WORKOS_CLIENT_ID;
    delete process.env.WORKOS_COOKIE_PASSWORD;
    delete process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) process.env[key] = value;
    }
  }

  it("requires a 32-char cookie password for session readiness", () => {
    expect(WORKOS_MIN_COOKIE_PASSWORD_LENGTH).toBe(32);
    setEnv({
      WORKOS_API_KEY: "sk_test_x",
      WORKOS_CLIENT_ID: "client_x",
      WORKOS_COOKIE_PASSWORD: "short",
    });
    expect(isWorkosSessionEnvReady()).toBe(false);
    // Presence-only fallback: short cookie selects AuthKit (fail closed),
    // never the fake adapter.
    expect(isWorkosEnvPresent()).toBe(true);
    expect(fakeSessionActive()).toBe(false);
  });

  it("short cookie fails closed (login unconfigured, no fake fallback)", () => {
    setEnv({
      NODE_ENV: "test",
      WORKOS_API_KEY: "sk_test_x",
      WORKOS_CLIENT_ID: "client_x",
      WORKOS_COOKIE_PASSWORD: "short",
      NEXT_PUBLIC_WORKOS_REDIRECT_URI: "http://localhost:3000/callback",
    });
    // Login page says unconfigured AND the picker refuses fake: a forged
    // ob_fake_session cookie cannot impersonate seed users here.
    expect(isWorkosConfigured()).toBe(false);
    expect(fakeSessionActive()).toBe(false);
  });

  it("full session env (no redirect URI) selects AuthKit reads", () => {
    setEnv({
      NODE_ENV: "test",
      WORKOS_API_KEY: "sk_test_x",
      WORKOS_CLIENT_ID: "client_x",
      WORKOS_COOKIE_PASSWORD: "c".repeat(32),
    });
    // Redirect URI only matters for minting sign-in URLs, not reads.
    expect(isWorkosSessionEnvReady()).toBe(true);
    expect(fakeSessionActive()).toBe(false);
    expect(isWorkosConfigured()).toBe(false);
  });

  it("AUTH_FAKE=1 selects fake outside production only", () => {
    setEnv({ NODE_ENV: "test", AUTH_FAKE: "1" });
    expect(fakeSessionActive()).toBe(true);
    setEnv({ NODE_ENV: "production", AUTH_FAKE: "1" });
    expect(fakeSessionActive()).toBe(false);
  });
});
