import { describe, it, expect } from "vitest";
import {
  OrgScopeError,
  UUIDContractError,
  assertInternalId,
  hasRole,
  requireRole,
} from "./org-scope";

describe("hasRole", () => {
  it("member berminimalis member", () => {
    expect(hasRole("member", "member")).toBe(true);
  });

  it("member tidak mencukupi admin", () => {
    expect(hasRole("member", "admin")).toBe(false);
  });

  it("admin mencukupi member", () => {
    expect(hasRole("admin", "member")).toBe(true);
  });

  it("owner mencukupi admin", () => {
    expect(hasRole("owner", "admin")).toBe(true);
  });

  it("admin tidak mencukupi owner", () => {
    expect(hasRole("admin", "owner")).toBe(false);
  });

  it("owner berminimalis owner", () => {
    expect(hasRole("owner", "owner")).toBe(true);
  });
});

describe("requireRole", () => {
  it("null => OrgScopeError NO_MEMBERSHIP", () => {
    expect(() => requireRole(null, "member")).toThrow(OrgScopeError);
    expect(() => requireRole(null, "member")).toThrow(/bukan anggota/i);
    const err = catchCode(() => requireRole(null, "member"));
    expect(err).toBe("NO_MEMBERSHIP");
  });

  it("member < admin => OrgScopeError INSUFFICIENT_ROLE", () => {
    const err = catchCode(() => requireRole({ role: "member" }, "admin"));
    expect(err).toBe("INSUFFICIENT_ROLE");
  });

  it("admin >= admin => lolos", () => {
    expect(requireRole({ role: "admin" }, "admin")).toEqual({ role: "admin" });
  });

  it("owner >= member => lolos", () => {
    expect(requireRole({ role: "owner" }, "member")).toEqual({ role: "owner" });
  });

  it("OrgScopeError adalah Error", () => {
    expect(new OrgScopeError("NO_MEMBERSHIP", "x")).toBeInstanceOf(Error);
  });
});

describe("internal-UUID contract", () => {
  const uuid = "6f9619ff-8b86-d011-b42d-00c04fc964ff";

  it("accepts internal DB UUIDs", () => {
    expect(() => assertInternalId("userId", uuid)).not.toThrow();
    expect(() => assertInternalId("orgId", uuid.toUpperCase())).not.toThrow();
  });

  it("rejects WorkOS user/org IDs with UUIDContractError", () => {
    const e = catchCode(() => assertInternalId("userId", "user_01H5Z3"));
    expect(e).toBeUndefined(); // not an OrgScopeError
    expect(() => assertInternalId("userId", "user_01H5Z3")).toThrow(
      UUIDContractError,
    );
    expect(() => assertInternalId("orgId", "org_01H5Z3")).toThrow(
      UUIDContractError,
    );
    try {
      assertInternalId("orgId", "org_01H5Z3");
    } catch (err) {
      expect(err).toBeInstanceOf(UUIDContractError);
      expect((err as UUIDContractError).parameter).toBe("orgId");
    }
  });
});

function catchCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof OrgScopeError ? e.code : undefined;
  }
  return undefined;
}

// requireOrgRole UUID-contract is exercised at the DB layer
// (src/lib/repos/repos.integration.test.ts); here we pin the pure predicate.
