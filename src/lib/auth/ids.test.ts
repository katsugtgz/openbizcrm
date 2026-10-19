import "dotenv/config";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Auth boundary pin: session WorkOS IDs must resolve to internal UUIDs.
 * Unit part runs everywhere; DB part (RUN_DB_TESTS=1) resolves against the
 * seeded org/users (src/db/seed.ts: workos ids "seed-owner-1" … and org
 * workos id "org_contoh-sejahtera").
 */
describe("resolveSessionIds", () => {
  let resolveSessionIds: typeof import("./ids").resolveSessionIds;

  beforeEach(async () => {
    ({ resolveSessionIds } = await import("./ids"));
  });

  it("returns null when the session user is unknown to the database", async () => {
    const resolved = await resolveSessionIds({
      id: "user_unknown_workos_id",
      email: "x@contoh.co.id",
      sessionId: "s",
      organizationId: "org_unknown",
    });
    expect(resolved).toBeNull();
  });

  // The next two resolve against seeded rows, so they need the database
  // (RUN_DB_TESTS=1): CI runs without it and the resolver correctly
  // returns null for unknown users there.
  const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

  itDb("resolves fake-session ids (seed-owner-1) to internal UUIDs", async () => {
    const resolved = await resolveSessionIds({
      id: "seed-owner-1",
      email: "owner@contoh.co.id",
      sessionId: "fake-session",
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(resolved!.orgId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  itDb("resolves WorkOS org id to the internal org UUID", async () => {
    const resolved = await resolveSessionIds({
      id: "seed-owner-1",
      email: "owner@contoh.co.id",
      sessionId: "fake-session",
      organizationId: "org_contoh-sejahtera",
    });
    expect(resolved).not.toBeNull();
    // Both adapters must land on the SAME internal org row.
    const fakeResolved = await resolveSessionIds({
      id: "seed-owner-1",
      email: "owner@contoh.co.id",
      sessionId: "fake-session",
    });
    expect(resolved!.orgId).toBe(fakeResolved!.orgId);
  });
});

describe("resolveSessionIds integration (seeded DB)", () => {
  const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

  itDb("requireOrgRole accepts the resolved ids", async () => {
    const { resolveSessionIds } = await import("./ids");
    const { requireOrgRole } = await import("@/lib/org-scope");
    const resolved = await resolveSessionIds({
      id: "seed-member-1",
      email: "member@contoh.co.id",
      sessionId: "fake-session",
    });
    expect(resolved).not.toBeNull();
    // Pinned P0 contract: internal UUIDs pass the guard that used to throw
    // UUIDContractError when handed WorkOS/fake session ids.
    await expect(
      requireOrgRole(resolved!.userId, resolved!.orgId, "member"),
    ).resolves.toEqual({ role: "member" });
  });

  itDb(
    "requireOrgRole still rejects raw WorkOS ids (contract intact)",
    async () => {
      const { requireOrgRole } = await import("@/lib/org-scope");
      await expect(
        requireOrgRole("seed-member-1", "org_contoh-sejahtera", "member"),
      ).rejects.toMatchObject({ name: "UUIDContractError" });
    },
  );
});
