import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, orgMemberships } from "@/db/schema";

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

export async function createOrg(
  input: { name: string; slug: string },
  ownerId: string,
): Promise<Organization> {
  const [org] = await db.insert(organizations).values(input).returning();
  await db
    .insert(orgMemberships)
    .values({ orgId: org.id, userId: ownerId, role: "owner" });
  return org;
}

export async function updateOrg(
  id: string,
  input: Partial<Pick<Organization, "name" | "slug">>,
): Promise<Organization> {
  const [org] = await db
    .update(organizations)
    .set(input)
    .where(eq(organizations.id, id))
    .returning();
  return org;
}
