import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { orgMemberships, users } from "@/db/schema";
import { requireOrgRole } from "@/lib/org-scope";
import type { Role } from "@/lib/org-scope";

export type OrgMembership = typeof orgMemberships.$inferSelect;

export async function listMembers(orgId: string) {
  return db
    .select({
      membership: orgMemberships,
      user: {
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
      },
    })
    .from(orgMemberships)
    .innerJoin(users, eq(users.id, orgMemberships.userId))
    .where(eq(orgMemberships.orgId, orgId));
}

export async function getMembership(
  orgId: string,
  userId: string,
): Promise<OrgMembership | null> {
  const [membership] = await db
    .select()
    .from(orgMemberships)
    .where(
      and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
    )
    .limit(1);
  return membership ?? null;
}

export async function addMember(
  actorId: string,
  orgId: string,
  userId: string,
  role: Role = "member",
): Promise<OrgMembership> {
  // Hanya owner boleh menciptakan owner lain — admin tidak boleh eskalasi.
  await requireOrgRole(actorId, orgId, role === "owner" ? "owner" : "admin");
  const [membership] = await db
    .insert(orgMemberships)
    .values({ orgId, userId, role })
    .returning();
  return membership;
}

export async function updateMemberRole(
  actorId: string,
  orgId: string,
  userId: string,
  role: Role,
): Promise<OrgMembership> {
  await requireOrgRole(actorId, orgId, "owner");
  await guardLastOwner(orgId, userId, role);
  const [membership] = await db
    .update(orgMemberships)
    .set({ role })
    .where(
      and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
    )
    .returning();
  if (!membership) {
    const err = new Error("Membership tidak ditemukan.");
    err.name = "NotFoundError";
    throw err;
  }
  return membership;
}

export async function removeMember(
  actorId: string,
  orgId: string,
  userId: string,
): Promise<void> {
  await requireOrgRole(actorId, orgId, "owner");
  await guardLastOwner(orgId, userId, null);
  await db
    .delete(orgMemberships)
    .where(
      and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
    );
}

/**
 * Cegah org yatim: operasi yang menghilangkan owner terakhir ditolak.
 * `newRole === null` berarti penghapusan membership.
 */
async function guardLastOwner(
  orgId: string,
  userId: string,
  newRole: Role | null,
): Promise<void> {
  if (newRole === "owner") return;
  const target = await getMembership(orgId, userId);
  if (!target || target.role !== "owner") return;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orgMemberships)
    .where(
      and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "owner")),
    );
  if (count <= 1) {
    const err = new Error(
      "Organisasi harus memiliki minimal satu owner; operasi ditolak.",
    );
    err.name = "LastOwnerError";
    throw err;
  }
}
