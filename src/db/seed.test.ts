import { describe, it, expect } from "vitest";
import { assertSeedAllowed } from "./seed";

describe("assertSeedAllowed (pure)", () => {
  it("refuses production without override", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(
      /production/,
    );
  });

  it("allows production with ALLOW_SEED=1", () => {
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "production", ALLOW_SEED: "1" }),
    ).not.toThrow();
  });

  it("allows dev/test/unset (CI runs unset)", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: "test" })).not.toThrow();
    expect(() => assertSeedAllowed({})).not.toThrow();
  });
});
