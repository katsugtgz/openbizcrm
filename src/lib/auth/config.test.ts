import { afterEach, describe, expect, it } from "vitest";
import {
  WORKOS_MIN_COOKIE_PASSWORD_LENGTH,
  isWorkosConfigured,
  isWorkosSessionEnvReady,
} from "./config";
import { fakeSessionActive } from "./index";

/**
 * Readiness predicates stay unified: the adapter picker (fakeSessionActive)
 * and the login/proxy check (isWorkosConfigured) share the session-env
 * verdict, so a short cookie can no longer select AuthKit while the login
 * page reports "unconfigured".
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
    expect(fakeSessionActive()).toBe(true);
  });

  it("short cookie agrees with the login-page verdict (no drift)", () => {
    setEnv({
      NODE_ENV: "test",
      WORKOS_API_KEY: "sk_test_x",
      WORKOS_CLIENT_ID: "client_x",
      WORKOS_COOKIE_PASSWORD: "short",
      NEXT_PUBLIC_WORKOS_REDIRECT_URI: "http://localhost:3000/callback",
    });
    // Login page says unconfigured AND the picker serves fake: consistent.
    expect(isWorkosConfigured()).toBe(false);
    expect(fakeSessionActive()).toBe(true);
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
