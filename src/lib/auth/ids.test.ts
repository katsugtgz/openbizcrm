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
  // The DB-backed cases resolve against seeded rows, so they need the
  // database (RUN_DB_TESTS=1): CI runs without it and the resolver
  // correctly returns null for unknown users there.
  const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

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

  itDb(
    "returns null for a known user whose organization id has no mapping",
    async () => {
      // Known user + unknown WorkOS org: resolver must NOT fall back to
      // currentOrgId when the session carries an org id — ignoring the
      // session's organizationId would silently cross org boundaries.
      const resolved = await resolveSessionIds({
        id: "seed-owner-1",
        email: "owner@contoh.co.id",
        sessionId: "fake-session",
        organizationId: "org_tidak_terdaftar",
      });
      expect(resolved).toBeNull();
    },
  );

  // The next two resolve against seeded rows, so they need the database
  // (RUN_DB_TESTS=1): CI runs without it and the resolver correctly
  // returns null for unknown users there.
  itDb(
    "resolves fake-session ids (seed-owner-1) to internal UUIDs",
    async () => {
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
    },
  );

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

  itDb(
    "provisions a brand-new AuthKit user + org and resolves on second call",
    async () => {
      const ids = await import("./ids");
      const { db } = await import("@/db");
      const { users, organizations, orgMemberships } =
        await import("@/db/schema");
      const { eq, inArray } = await import("drizzle-orm");
      const workosUserId = `test_prov_user_${Date.now()}`;
      const workosOrgId = `test_prov_org_${Date.now()}`;
      const createdUserIds: string[] = [];
      const createdOrgIds: string[] = [];
      // Simulate AuthKit mode: provisioning is fake-mode-gated (AUTH_FAKE=1
      // or missing WorkOS config), so clear AUTH_FAKE and stub the WorkOS
      // env vars for the duration of this test.
      const prevFake = process.env.AUTH_FAKE;
      const prevKey = process.env.WORKOS_API_KEY;
      const prevCid = process.env.WORKOS_CLIENT_ID;
      const prevPwd = process.env.WORKOS_COOKIE_PASSWORD;
      process.env.AUTH_FAKE = "";
      process.env.WORKOS_API_KEY = "test";
      process.env.WORKOS_CLIENT_ID = "test";
      process.env.WORKOS_COOKIE_PASSWORD = "x".repeat(32);
      try {
        const sessionUser = {
          id: workosUserId,
          email: `prov-${Date.now()}@contoh.co.id`,
          firstName: "Provi",
          lastName: "Sion",
          sessionId: "authkit-session",
          organizationId: workosOrgId,
        };
        const first = await ids.resolveSessionIds(sessionUser);
        // Provisioned: internal user + org + membership, 'member' role.
        expect(first).not.toBeNull();
        const [dbUser] = await db
          .select()
          .from(users)
          .where(eq(users.workosUserId, workosUserId))
          .limit(1);
        expect(dbUser.name).toBe("Provi Sion");
        createdUserIds.push(dbUser.id);
        const [dbOrg] = await db
          .select()
          .from(organizations)
          .where(eq(organizations.workosOrgId, workosOrgId))
          .limit(1);
        createdOrgIds.push(dbOrg.id);
        expect(dbOrg.slug).toBe(workosOrgId);
        expect(first!.userId).toBe(dbUser.id);
        expect(first!.orgId).toBe(dbOrg.id);
        const [membership] = await db
          .select()
          .from(orgMemberships)
          .where(eq(orgMemberships.userId, dbUser.id))
          .limit(1);
        expect(membership).toMatchObject({
          orgId: dbOrg.id,
          role: "member",
        });
        expect(dbUser.currentOrgId).toBe(dbOrg.id);

        // Second call resolves the same ids (steady state after provision).
        const second = await ids.resolveSessionIds(sessionUser);
        expect(second).toEqual(first);
      } finally {
        // Test rows: membership/user cascade; org delete cascades too.
        await db.delete(users).where(inArray(users.id, createdUserIds));
        await db
          .delete(organizations)
          .where(inArray(organizations.id, createdOrgIds));
        process.env.AUTH_FAKE = prevFake;
        process.env.WORKOS_API_KEY = prevKey;
        process.env.WORKOS_CLIENT_ID = prevCid;
        process.env.WORKOS_COOKIE_PASSWORD = prevPwd;
      }
    },
  );

  itDb(
    "provisioning an AuthKit user with an existing seeded org resolves it",
    async () => {
      // New user, existing WorkOS org id (seed org): membership added, no
      // duplicate org row.
      const { db } = await import("@/db");
      const { users, orgMemberships } = await import("@/db/schema");
      const { eq, and, inArray } = await import("drizzle-orm");
      const workosUserId = `test_prov_user2_${Date.now()}`;
      const prevFake = process.env.AUTH_FAKE;
      const prevKey = process.env.WORKOS_API_KEY;
      const prevCid = process.env.WORKOS_CLIENT_ID;
      const prevPwd = process.env.WORKOS_COOKIE_PASSWORD;
      process.env.AUTH_FAKE = "";
      process.env.WORKOS_API_KEY = "test";
      process.env.WORKOS_CLIENT_ID = "test";
      process.env.WORKOS_COOKIE_PASSWORD = "x".repeat(32);
      try {
        const { resolveSessionIds } = await import("./ids");
        const resolved = await resolveSessionIds({
          id: workosUserId,
          email: `prov2-${Date.now()}@contoh.co.id`,
          sessionId: "authkit-session",
          organizationId: "org_contoh-sejahtera",
        });
        expect(resolved).not.toBeNull();
        const [membership] = await db
          .select()
          .from(orgMemberships)
          .where(and(eq(orgMemberships.userId, resolved!.userId)))
          .limit(1);
        expect(membership).toMatchObject({ role: "member" });
      } finally {
        await db
          .delete(users)
          .where(inArray(users.workosUserId, [workosUserId]));
        process.env.AUTH_FAKE = prevFake;
        process.env.WORKOS_API_KEY = prevKey;
        process.env.WORKOS_CLIENT_ID = prevCid;
        process.env.WORKOS_COOKIE_PASSWORD = prevPwd;
      }
    },
  );
});
