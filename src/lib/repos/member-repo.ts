import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orgMemberships, users } from "@/db/schema";
import { NotFoundError, requireOrgRole } from "@/lib/org-scope";
import type { Role } from "@/lib/org-scope";

export type OrgMembership = typeof orgMemberships.$inferSelect;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function listMembers(actorId: string, orgId: string) {
  // Member PII (emails, names) is org-confidential: the caller must belong
  // to the org before any rows are returned (cubic P1 member-repo:9).
  await requireOrgRole(actorId, orgId, "member");
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
  return db.transaction(async (tx) => {
    await guardLastOwner(tx, orgId, userId, role);
    const [membership] = await tx
      .update(orgMemberships)
      .set({ role })
      .where(
        and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
      )
      .returning();
    if (!membership) throw new NotFoundError("Membership tidak ditemukan.");
    return membership;
  });
}

export async function removeMember(
  actorId: string,
  orgId: string,
  userId: string,
): Promise<void> {
  await requireOrgRole(actorId, orgId, "owner");
  await db.transaction(async (tx) => {
    await guardLastOwner(tx, orgId, userId, null);
    await tx
      .delete(orgMemberships)
      .where(
        and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
      );
  });
}

/**
 * Cegah org yatim: operasi yang menghilangkan owner terakhir ditolak.
 * `newRole === null` berarti penghapusan membership.
 *
 * Atomicity (cubic P1 member-repo:103): the count and the mutation share one
 * transaction, and the owner rows are locked with SELECT ... FOR UPDATE so two
 * concurrent demotions cannot both pass the count check and leave the org
 * with zero owners.
 */
async function guardLastOwner(
  tx: Tx,
  orgId: string,
  userId: string,
  newRole: Role | null,
): Promise<void> {
  if (newRole === "owner") return;
  const [target] = await tx
    .select({ id: orgMemberships.id, role: orgMemberships.role })
    .from(orgMemberships)
    .where(
      and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
    )
    .limit(1)
    .for("update");
  if (!target || target.role !== "owner") return;
  // FOR UPDATE cannot lock an aggregate, so lock the owner rows themselves:
  // any concurrent owner-mutation transaction blocks here until this one
  // commits, making the stale count race impossible.
  const owners = await tx
    .select({ id: orgMemberships.id })
    .from(orgMemberships)
    .where(
      and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "owner")),
    )
    .for("update");
  if (owners.length <= 1) {
    throw new LastOwnerError();
  }
}

export class LastOwnerError extends Error {
  constructor() {
    super("Organisasi harus memiliki minimal satu owner; operasi ditolak.");
    this.name = "LastOwnerError";
  }
}
