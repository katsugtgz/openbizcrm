import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { OrgScopeError, requireOrgRole } from "@/lib/org-scope";

export type Branch = typeof branches.$inferSelect;

export async function listBranches(orgId: string): Promise<Branch[]> {
  return db
    .select()
    .from(branches)
    .where(eq(branches.orgId, orgId))
    .orderBy(branches.name);
}

export async function getBranch(
  orgId: string,
  id: string,
): Promise<Branch | null> {
  const [branch] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, id), eq(branches.orgId, orgId)))
    .limit(1);
  return branch ?? null;
}

export async function createBranch(
  userId: string,
  orgId: string,
  input: { name: string; address?: string | null },
): Promise<Branch> {
  await requireOrgRole(userId, orgId, "member");
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
  await requireOrgRole(userId, orgId, "member");
  const [branch] = await db
    .update(branches)
    .set(input)
    .where(and(eq(branches.id, id), eq(branches.orgId, orgId)))
    .returning();
  if (!branch) {
    throw new OrgScopeError("NO_MEMBERSHIP", "Cabang tidak ditemukan.");
  }
  return branch;
}
