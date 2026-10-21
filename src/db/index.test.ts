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
    expect(
      shouldRequireSsl("postgres://u:p@db.internal/db?sslmode=verify-full"),
    ).toBe(false);
  });

  it("unknown sslmode values fall back to the host default (cubic pr10)", () => {
    // postgres-js leaves SSL disabled for these: remote stays encrypted.
    expect(
      shouldRequireSsl("postgres://u:p@db.internal/db?sslmode=prefer"),
    ).toBe(true);
    expect(
      shouldRequireSsl("postgres://u:p@db.internal/db?sslmode=requier"),
    ).toBe(true);
    expect(
      shouldRequireSsl("postgres://u:p@localhost/db?sslmode=prefer"),
    ).toBe(false);
  });

  it("unix-socket ?host= entries stay plaintext (cubic pr10 r2)", () => {
    expect(
      shouldRequireSsl(
        "postgres://u:p@localhost:5432/db?host=/var/run/postgresql",
      ),
    ).toBe(false);
    expect(
      shouldRequireSsl(
        "postgres://u:p@localhost:5432/db?host=/var/run/postgresql,db.internal",
      ),
    ).toBe(true);
  });

  it("postgres-js ?host= override decides, not the authority (cubic pr10)", () => {
    expect(
      shouldRequireSsl("postgres://u:p@localhost:5432/db?host=db.internal"),
    ).toBe(true);
    expect(
      shouldRequireSsl("postgres://u:p@db.internal:5432/db?host=localhost"),
    ).toBe(false);
    // Multi-host: any non-loopback host requires TLS.
    expect(
      shouldRequireSsl(
        "postgres://u:p@localhost:5432/db?host=localhost,db.internal",
      ),
    ).toBe(true);
    expect(
      shouldRequireSsl(
        "postgres://u:p@localhost:5432/db?host=127.0.0.1,localhost",
      ),
    ).toBe(false);
  });

  it("unparseable URL fails closed to false (resolveDatabaseUrl throws later)", () => {
    expect(shouldRequireSsl("not-a-url")).toBe(false);
  });
});
