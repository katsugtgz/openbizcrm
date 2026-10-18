import { describe, it, expect } from "vitest";
import { OrgScopeError, hasRole, requireRole } from "./org-scope";

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
    expect(() => requireRole(null, "member")).toThrow(
      /bukan anggota/i,
    );
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

function catchCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof OrgScopeError ? e.code : undefined;
  }
  return undefined;
}
