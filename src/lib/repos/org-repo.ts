import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, orgMemberships } from "@/db/schema";
import { NotFoundError, requireOrgRole } from "@/lib/org-scope";

export type Organization = typeof organizations.$inferSelect;

export async function getOrg(id: string): Promise<Organization | null> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);
  return org ?? null;
}

export async function getOrgBySlug(slug: string): Promise<Organization | null> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  return org ?? null;
}

/**
 * Org + owner membership are inserted atomically: a missing user or a failed
 * membership insert rolls the whole creation back instead of leaving an
 * ownerless org whose slug blocks retries (cubic P1 org-repo:29).
 */
export async function createOrg(
  input: { name: string; slug: string },
  ownerId: string,
): Promise<Organization> {
  return db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values(input).returning();
    await tx
      .insert(orgMemberships)
      .values({ orgId: org.id, userId: ownerId, role: "owner" });
    return org;
  });
}

export async function updateOrg(
  actorId: string,
  id: string,
  input: Partial<Pick<Organization, "name" | "slug">>,
): Promise<Organization> {
  // Renaming/re-slugging is owner/admin territory; without this guard any
  // caller forwarding an org id could modify another tenant (cubic P1
  // org-repo:36).
  await requireOrgRole(actorId, id, "admin");
  const [org] = await db
    .update(organizations)
    .set(input)
    .where(eq(organizations.id, id))
    .returning();
  if (!org) throw new NotFoundError("Organisasi tidak ditemukan.");
  return org;
}
