import { and, eq } from "drizzle-orm";
import { orgMemberships } from "@/db/schema";
import type { db } from "@/db";

/** A live connection or an open transaction — guard reuses the caller's. */
export type DbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Role = "owner" | "admin" | "member";

/**
 * Thrown when WorkOS session IDs (user_xxx / org_xxx) reach the DB guard.
 * requireOrgRole only matches internal database UUIDs; callers must resolve
 * external IDs at the auth boundary first.
 */
export class UUIDContractError extends Error {
  constructor(
    public parameter: "userId" | "orgId",
    message: string,
  ) {
    super(message);
    this.name = "UUIDContractError";
  }
}

// Any hex-hex-variant-4 [89ab] variantUUID shape: gen_random_uuid() emits v4
// but historical rows and fixtures may carry other hex version nibbles, and
// WorkOS IDs ("user_…", "org_…") never match this shape — that is the point.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Internal-ID contract check (pure): DB UUIDs only, not WorkOS IDs. */
export function assertInternalId(
  parameter: "userId" | "orgId",
  value: string,
): void {
  if (UUID_RE.test(value)) return;
  // Never echo the full caller-controlled value (log/URL reflection): a
  // short preview is enough to triage which id failed the contract.
  const shown = value.length > 32 ? `${value.slice(0, 32)}…` : value;
  throw new UUIDContractError(
    parameter,
    `WorkOS IDs cannot query the database directly; resolve ${parameter} to the internal UUID first (got: ${shown}).`,
  );
}

/** Thrown when a targeted row (branch, membership, user, org) does not exist
 * or belongs to another org. Distinct from OrgScopeError NO_MEMBERSHIP, which
 * means the CALLER lacks access — NotFoundError means the TARGET is gone. */
export class NotFoundError extends Error {
  constructor(message = "Data tidak ditemukan.") {
    super(message);
    this.name = "NotFoundError";
  }
}

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
 * Pure check: whether `actual` satisfies the minimum `required` role.
 */
export function hasRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/**
 * Pure guard: throw OrgScopeError when the membership lacks the minimum role.
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
 * DB-backed guard: find the user membership in the org, then requireRole.
 * Throws OrgScopeError NO_MEMBERSHIP / INSUFFICIENT_ROLE.
 */
export async function requireOrgRole(
  userId: string,
  orgId: string,
  required: Role,
  exec?: DbExecutor,
): Promise<{ role: Role }> {
  // Internal-ID contract: both params must be database UUIDs. Session
  // values (WorkOS user/org IDs) never match memberships and would
  // silently return NO_MEMBERSHIP — fail loudly instead.
  assertInternalId("userId", userId);
  assertInternalId("orgId", orgId);
  // exec (cubic pr10 cuti:216): callers inside a transaction pass their
  // tx so the guard reuses the tx connection instead of grabbing a second
  // pooled connection (pool exhaustion under concurrent approvals).
  const q = exec ?? (await import("@/db")).db;
  const [membership] = await q
    .select({ role: orgMemberships.role })
    .from(orgMemberships)
    .where(
      and(eq(orgMemberships.userId, userId), eq(orgMemberships.orgId, orgId)),
    )
    .limit(1);
  return requireRole(membership, required);
}
