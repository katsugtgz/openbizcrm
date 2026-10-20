import { describe, it, expect } from "vitest";
import { shouldRequireSsl } from "./index";

describe("shouldRequireSsl (pure)", () => {
  it("loopback hosts stay plaintext", () => {
    expect(shouldRequireSsl("postgres://u:p@localhost:5432/db")).toBe(false);
    expect(shouldRequireSsl("postgres://u:p@127.0.0.1:5432/db")).toBe(false);
    expect(shouldRequireSsl("postgres://u:p@[::1]:5432/db")).toBe(false);
  });

  it("non-local hosts require ssl", () => {
    expect(shouldRequireSsl("postgres://u:p@db.internal:5432/db")).toBe(true);
    expect(
      shouldRequireSsl("postgres://u:p@ep-abc.us-east-2.aws.neon.tech/db"),
    ).toBe(true);
  });

  it("explicit sslmode in URL wins (no forced override)", () => {
    expect(
      shouldRequireSsl("postgres://u:p@db.internal/db?sslmode=disable"),
    ).toBe(false);
    expect(
      shouldRequireSsl("postgres://u:p@db.internal/db?sslmode=require"),
    ).toBe(false);
  });

  it("unparseable URL fails closed to false (resolveDatabaseUrl throws later)", () => {
    expect(shouldRequireSsl("not-a-url")).toBe(false);
  });
});
