import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  branches,
  organizations,
  orgMemberships,
  users,
} from "@/db/schema";

const ORG_NAME = "PT Contoh Sejahtera";
const ORG_SLUG = "contoh-sejahtera";

const SEED_USERS = [
  {
    workosUserId: "seed-owner-1",
    email: "owner@contoh.co.id",
    name: "Budi Owner",
    role: "owner" as const,
  },
  {
    workosUserId: "seed-admin-1",
    email: "admin@contoh.co.id",
    name: "Sari Admin",
    role: "admin" as const,
  },
  {
    workosUserId: "seed-member-1",
    email: "member@contoh.co.id",
    name: "Andi Member",
    role: "member" as const,
  },
];

const SEED_BRANCHES = [
  { name: "Kantor Pusat", address: "Jl. Jend. Sudirman No. 1, Jakarta" },
  { name: "Cabang Surabaya", address: "Jl. Basuki Rahmat No. 10, Surabaya" },
];

/**
 * Idempotent + concurrency-safe seed. Everything runs inside one transaction
 * serialized by a session-level advisory lock keyed on the org slug, so two
 * overlapping invocations cannot race the select-then-insert checks (cubic
 * P2 seed:33). Conflict-safe upserts (onConflictDoNothing) make re-runs and
 * stragglers harmless even after the lock is released.
 */
async function seed() {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('openbizcrm-seed'))`,
    );

    // Org
    let [org] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.slug, ORG_SLUG))
      .limit(1);
    if (!org) {
      [org] = await tx
        .insert(organizations)
        .values({ name: ORG_NAME, slug: ORG_SLUG })
        .onConflictDoNothing()
        .returning();
      if (!org) {
        // Concurrent seed inserted it between lock release risk — re-read.
        [org] = await tx
          .select()
          .from(organizations)
          .where(eq(organizations.slug, ORG_SLUG))
          .limit(1);
      }
      console.log(`+ org ${ORG_SLUG}`);
    }

    // Branches — org-scoped unique constraint makes this conflict-safe.
    for (const b of SEED_BRANCHES) {
      await tx
        .insert(branches)
        .values({ orgId: org.id, ...b })
        .onConflictDoNothing({
          target: [branches.orgId, branches.name],
        });
      console.log(`+ branch ${b.name}`);
    }

    // Users + memberships — workosUserId/email unique make this safe.
    for (const u of SEED_USERS) {
      let [user] = await tx
        .select()
        .from(users)
        .where(eq(users.workosUserId, u.workosUserId))
        .limit(1);
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({
            workosUserId: u.workosUserId,
            email: u.email,
            name: u.name,
            currentOrgId: org.id,
          })
          .onConflictDoNothing()
          .returning();
        if (!user) {
          [user] = await tx
            .select()
            .from(users)
            .where(eq(users.workosUserId, u.workosUserId))
            .limit(1);
        }
        console.log(`+ user ${u.workosUserId}`);
      }
      await tx
        .insert(orgMemberships)
        .values({ orgId: org.id, userId: user.id, role: u.role })
        .onConflictDoNothing({
          target: [orgMemberships.orgId, orgMemberships.userId],
        });
      console.log(`+ membership ${u.workosUserId} (${u.role})`);
    }

    // Audit sample
    const logs = await tx
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.orgId, org.id));
    if (logs.length === 0) {
      const [owner] = await tx
        .select()
        .from(users)
        .where(eq(users.workosUserId, "seed-owner-1"))
        .limit(1);
      await tx.insert(auditLogs).values({
        orgId: org.id,
        userId: owner.id,
        action: "seed.sample",
        entity: "organization",
        entityId: org.id,
        metadata: { source: "seed" },
      });
      console.log("+ audit sample");
    }
  });

  console.log("Seed selesai (idempotent).");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
