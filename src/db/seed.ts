import "dotenv/config";
import { eq } from "drizzle-orm";
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

async function seed() {
  // Org
  let [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, ORG_SLUG))
    .limit(1);
  if (!org) {
    [org] = await db
      .insert(organizations)
      .values({ name: ORG_NAME, slug: ORG_SLUG })
      .returning();
    console.log(`+ org ${ORG_SLUG}`);
  }

  // Branches (idempotent by name)
  for (const b of SEED_BRANCHES) {
    const existing = await db
      .select()
      .from(branches)
      .where(eq(branches.orgId, org.id));
    if (!existing.some((row) => row.name === b.name)) {
      await db.insert(branches).values({ orgId: org.id, ...b });
      console.log(`+ branch ${b.name}`);
    }
  }

  // Users + memberships (idempotent by workosUserId)
  for (const u of SEED_USERS) {
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.workosUserId, u.workosUserId))
      .limit(1);
    if (!user) {
      [user] = await db
        .insert(users)
        .values({
          workosUserId: u.workosUserId,
          email: u.email,
          name: u.name,
          currentOrgId: org.id,
        })
        .returning();
      console.log(`+ user ${u.workosUserId}`);
    }
    const existing = await db
      .select()
      .from(orgMemberships)
      .where(eq(orgMemberships.orgId, org.id));
    if (!existing.some((m) => m.userId === user.id)) {
      await db
        .insert(orgMemberships)
        .values({ orgId: org.id, userId: user.id, role: u.role });
      console.log(`+ membership ${u.workosUserId} (${u.role})`);
    }
  }

  // Audit sample
  const logs = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.orgId, org.id));
  if (logs.length === 0) {
    const [owner] = await db
      .select()
      .from(users)
      .where(eq(users.workosUserId, "seed-owner-1"))
      .limit(1);
    await db.insert(auditLogs).values({
      orgId: org.id,
      userId: owner.id,
      action: "seed.sample",
      entity: "organization",
      entityId: org.id,
      metadata: { source: "seed" },
    });
    console.log("+ audit sample");
  }

  console.log("Seed selesai (idempotent).");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
