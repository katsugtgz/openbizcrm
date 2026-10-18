import { and, eq } from "drizzle-orm";
import { orgMemberships } from "@/db/schema";

export type Role = "owner" | "admin" | "member";

export class OrgScopeError extends Error {
  constructor(
    public code: "NO_MEMBERSHIP" | "INSUFFICIENT_ROLE",
    message: string,
  ) {
    super(message);
    this.name = "OrgScopeError";
  }
}

const ROLE_RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

/**
 * Pure check: apakah `actual` memenuhi `required` minimal.
 */
export function hasRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/**
 * Pure guard: lempar OrgScopeError kalau membership tak memenuhi role minimal.
 */
export function requireRole(
  membership: { role: Role } | null | undefined,
  required: Role,
): { role: Role } {
  if (!membership) {
    throw new OrgScopeError(
      "NO_MEMBERSHIP",
      "Anda bukan anggota organisasi ini.",
    );
  }
  if (!hasRole(membership.role, required)) {
    throw new OrgScopeError(
      "INSUFFICIENT_ROLE",
      `Peran ${required} atau lebih tinggi dibutuhkan.`,
    );
  }
  return membership;
}

/**
 * Guard berbasis DB: cari membership user di org, lalu requireRole.
 * Melempar OrgScopeError NO_MEMBERSHIP / INSUFFICIENT_ROLE.
 */
export async function requireOrgRole(
  userId: string,
  orgId: string,
  required: Role,
): Promise<{ role: Role }> {
  const { db } = await import("@/db");
  const [membership] = await db
    .select({ role: orgMemberships.role })
    .from(orgMemberships)
    .where(
      and(eq(orgMemberships.userId, userId), eq(orgMemberships.orgId, orgId)),
    )
    .limit(1);
  return requireRole(membership, required);
}
