import { describe, expect, it } from "vitest";
import { pgErrorParts } from "./db-errors";

/**
 * pgErrorParts must read through drizzle's DrizzleQueryError wrapper: the
 * SQLSTATE code and constraint name live on `cause` (cubic pr10 r4).
 */
describe("pgErrorParts", () => {
  it("reads code + constraint_name through the DrizzleQueryError cause", () => {
    const err = Object.assign(new Error("Failed query"), {
      cause: { code: "23505", constraint_name: "employees_org_user_unique" },
    });
    expect(pgErrorParts(err)).toEqual({
      code: "23505",
      constraint: "employees_org_user_unique",
    });
  });

  it("reads a Neon-style `constraint` on the outer error", () => {
    expect(pgErrorParts({ code: "23503", constraint: "deals_company_fk" })).toEqual({
      code: "23503",
      constraint: "deals_company_fk",
    });
  });

  it("handles a plain PG error with no cause", () => {
    expect(
      pgErrorParts({ code: "23505", constraint_name: "contacts_org_email_unique" }),
    ).toEqual({ code: "23505", constraint: "contacts_org_email_unique" });
  });

  it("returns empty parts for unknown shapes", () => {
    expect(pgErrorParts(new Error("boom"))).toEqual({
      code: undefined,
      constraint: undefined,
    });
    expect(pgErrorParts(null)).toEqual({ code: undefined, constraint: undefined });
  });
});
