import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { NotFoundError, requireOrgRole } from "@/lib/org-scope";

export type Branch = typeof branches.$inferSelect;

/**
 * Org-scoped reads: the caller must at least be a member of `orgId`, otherwise
 * a client-selected org id would disclose branch names/addresses across
 * tenants (cubic P1 branch-repo:8).
 */
export async function listBranches(
  userId: string,
  orgId: string,
): Promise<Branch[]> {
  await requireOrgRole(userId, orgId, "member");
  return db
    .select()
    .from(branches)
    .where(eq(branches.orgId, orgId))
    .orderBy(branches.name);
}

export async function getBranch(
  userId: string,
  orgId: string,
  id: string,
): Promise<Branch | null> {
  await requireOrgRole(userId, orgId, "member");
  const [branch] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, id), eq(branches.orgId, orgId)))
    .limit(1);
  return branch ?? null;
}

// Branch structure is admin territory; plain members must not create or
// rename branches (cubic P1 branch-repo:33).
export async function createBranch(
  userId: string,
  orgId: string,
  input: { name: string; address?: string | null },
): Promise<Branch> {
  await requireOrgRole(userId, orgId, "admin");
  const [branch] = await db
    .insert(branches)
    .values({ orgId, ...input })
    .returning();
  return branch;
}

export async function updateBranch(
  userId: string,
  orgId: string,
  id: string,
  input: Partial<Pick<Branch, "name" | "address">>,
): Promise<Branch> {
  await requireOrgRole(userId, orgId, "admin");
  const [branch] = await db
    .update(branches)
    .set(input)
    .where(and(eq(branches.id, id), eq(branches.orgId, orgId)))
    .returning();
  // Stale/foreign id is a NotFoundError, not an authorization error: the
  // caller may have admin rights yet address a deleted branch.
  if (!branch) throw new NotFoundError("Cabang tidak ditemukan.");
  return branch;
}
