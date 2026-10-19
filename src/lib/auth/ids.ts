/**
 * Auth boundary: WorkOS session IDs -> internal database UUIDs.
 *
 * session.userId is a WorkOS "user_…" id and session.organizationId a WorkOS
 * "org_…" id. requireOrgRole and every repo accept INTERNAL users.id /
 * organizations.id UUIDs only (UUIDContractError otherwise — cubic P0
 * crm-actions:50 / proyek-actions:39). Every server component and server
 * action MUST resolve here before touching org-scoped guards or repos.
 *
 * Mapping:
 * - user: users.workos_user_id = session.id (fake mode signs in with the
 *   seeded workos ids "seed-owner-1" etc., so the same lookup covers both
 *   adapters).
 * - org: AuthKit session carries the WorkOS org id -> organizations.
 *   workos_org_id. Fake sessions carry none -> fall back to the user's
 *   currentOrgId (seed/dev flow).
 *
 * Returns null when the user or org is not provisioned in the database —
 * callers redirect (pages) or throw (actions).
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import type { SessionUser } from "./types";
import { getUserByWorkosId } from "@/lib/repos/user-repo";

export interface ResolvedIds {
  /** Internal users.id UUID — pass to requireOrgRole / repos. */
  userId: string;
  /** Internal organizations.id UUID — pass to requireOrgRole / repos. */
  orgId: string;
}

export async function resolveSessionIds(
  user: SessionUser,
): Promise<ResolvedIds | null> {
  const dbUser = await getUserByWorkosId(user.id);
  if (!dbUser) return null;

  let orgId: string | null = null;
  if (user.organizationId) {
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.workosOrgId, user.organizationId))
      .limit(1);
    orgId = org?.id ?? null;
  } else {
    orgId = dbUser.currentOrgId;
  }
  if (!orgId) return null;

  return { userId: dbUser.id, orgId };
}
