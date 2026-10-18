import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseBoolean, requiredEnv } from "../env";

describe("parseBoolean", () => {
  it.each([
    ["1", true],
    ["true", true],
    ["TRUE", true],
    ["True", true],
    ["yes", true],
    ["YES", true],
    ["on", true],
    ["  true  ", true], // trims whitespace
    ["0", false],
    ["false", false],
    ["FALSE", false],
    ["no", false],
    ["off", false],
    ["nope", false],
    ["", false],
    ["   ", false],
  ])("parses %j as %j", (input, expected) => {
    expect(parseBoolean(input, false)).toBe(expected);
  });

  it("returns fallback when value is undefined", () => {
    expect(parseBoolean(undefined, true)).toBe(true);
    expect(parseBoolean(undefined, false)).toBe(false);
  });

  it("returns fallback for unrecognized values, honoring the given fallback", () => {
    expect(parseBoolean("banana", true)).toBe(true);
    expect(parseBoolean("banana", false)).toBe(false);
  });
});

describe("requiredEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns the value when present", () => {
    expect(requiredEnv("MY_KEY", () => "some-value", "development")).toBe(
      "some-value",
    );
  });

  it("throws a clear error naming the key in production", () => {
    expect(() =>
      requiredEnv("DATABASE_URL", () => undefined, "production"),
    ).toThrowError(/Missing required environment variable: DATABASE_URL/);
  });

  it("also throws in production when the value is an empty string", () => {
    expect(() => requiredEnv("TOKEN", () => "", "production")).toThrowError(
      /Missing required environment variable: TOKEN/,
    );
  });

  it("warns and returns undefined (not throws) outside production", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = requiredEnv("DATABASE_URL", () => undefined, "development");

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Missing required environment variable: DATABASE_URL",
      ),
    );
  });

  it("treats missing NODE_ENV as non-production (warn, not throw)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(requiredEnv("X", () => undefined, undefined)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledOnce();
  });
});
