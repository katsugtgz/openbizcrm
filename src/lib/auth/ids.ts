/**
 * Auth boundary: WorkOS session IDs -> internal database UUIDs.
 *
 * session.userId is a WorkOS "user_…" id and session.organizationId a WorkOS
 * "org_…" id. requireOrgRole and every repo accept INTERNAL users.id /
 * organizations.id UUIDs only (UUIDContractError otherwise). Every server
 * component and server action MUST resolve here before touching org-scoped
 * guards or repos.
 *
 * Mapping:
 * - user: users.workos_user_id = session.id (fake mode signs in with the
 *   seeded workos ids "seed-owner-1" etc., so the same lookup covers both
 *   adapters).
 * - org: AuthKit session carries the WorkOS org id -> organizations.
 *   workos_org_id. Fake sessions carry none -> fall back to the user's
 *   currentOrgId (seed/dev flow).
 *
 * Contract:
 * - Fake mode (AUTH_FAKE=1 or WorkOS unconfigured) NEVER provisions: an
 *   unknown session id resolves null and dev/tests rely strictly on the seed.
 * - AuthKit mode auto-provisions on first login: internal user row, and when
 *   the session carries an org id also the organization row (name/slug fall
 *   back to the WorkOS org id), a 'member' membership and currentOrgId. The
 *   whole provisioning runs in one transaction and any failure resolves
 *   null — a broken provisioning path can never block sign-in.
 * - A resolved orgId always implies a local orgMemberships row: the WorkOS
 *   org mapping alone is not authorization. Callers still run requireOrgRole
 *   for role checks; bare membership is guaranteed here.
 *
 * Returns null when the user or org is not (and cannot be) provisioned —
 * callers redirect (pages) or throw (actions).
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, orgMemberships, users } from "@/db/schema";
import type { SessionUser } from "./types";
import { getUserByWorkosId } from "@/lib/repos/user-repo";
import { fakeSessionActive } from "./index";

export interface ResolvedIds {
  /** Internal users.id UUID — pass to requireOrgRole / repos. */
  userId: string;
  /** Internal organizations.id UUID — pass to requireOrgRole / repos. */
  orgId: string;
}

/**
 * First-login provisioning for AuthKit users unknown to the database.
 * Upserts the internal user; when the session carries a WorkOS org id, also
 * upserts the organization, a 'member' membership and currentOrgId.
 * Swallows every error into null so login never breaks on provisioning.
 */
async function provision(
  user: SessionUser,
): Promise<{ userId: string; orgId: string | null } | null> {
  try {
    return await db.transaction(async (tx) => {
      const name =
        [user.firstName, user.lastName].filter(Boolean).join(" ") || null;
      let [dbUser] = await tx
        .insert(users)
        .values({ workosUserId: user.id, email: user.email, name })
        .onConflictDoNothing()
        .returning();
      if (!dbUser) {
        // Conflict (email taken by another workos id, or raced insert):
        // re-read by workos id only — never adopt a mismatched email row.
        [dbUser] = await tx
          .select()
          .from(users)
          .where(eq(users.workosUserId, user.id))
          .limit(1);
      }
      if (!dbUser) return null;

      let orgId: string | null = null;
      if (user.organizationId) {
        let [org] = await tx
          .insert(organizations)
          .values({
            // WorkOS gives us only the org id here; id doubles as name and
            // slug fallback until renamed manually.
            name: user.organizationId,
            slug: user.organizationId,
            workosOrgId: user.organizationId,
          })
          .onConflictDoNothing()
          .returning();
        if (!org) {
          [org] = await tx
            .select()
            .from(organizations)
            .where(eq(organizations.workosOrgId, user.organizationId))
            .limit(1);
        }
        if (org) {
          orgId = org.id;
          // Provisioned users are plain members, never owners.
          await tx
            .insert(orgMemberships)
            .values({ orgId: org.id, userId: dbUser.id, role: "member" })
            .onConflictDoNothing({
              target: [orgMemberships.orgId, orgMemberships.userId],
            });
          if (!dbUser.currentOrgId) {
            await tx
              .update(users)
              .set({ currentOrgId: org.id })
              .where(eq(users.id, dbUser.id));
          }
        }
      }
      return { userId: dbUser.id, orgId };
    });
  } catch (e) {
    console.error("[ids.provision] failed:", e);
    return null;
  }
}

export async function resolveSessionIds(
  user: SessionUser,
): Promise<ResolvedIds | null> {
  const dbUser = await getUserByWorkosId(user.id);

  // Fake mode stays strict: unknown fake session ids resolve null and tests
  // keep relying on the seed (no auto-created rows).
  if (!dbUser && !fakeSessionActive()) {
    const provisioned = await provision(user);
    if (!provisioned?.orgId) return null;
    return { userId: provisioned.userId, orgId: provisioned.orgId };
  }
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

  // The WorkOS org mapping alone is not authorization: require the local
  // membership row before handing out the internal org id.
  const [membership] = await db
    .select({ id: orgMemberships.id })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.orgId, orgId),
        eq(orgMemberships.userId, dbUser.id),
      ),
    )
    .limit(1);
  if (!membership) return null;

  return { userId: dbUser.id, orgId };
}
