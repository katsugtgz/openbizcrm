import "dotenv/config";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orgMemberships, organizations, users } from "@/db/schema";
import { createOrg, getOrgBySlug } from "@/lib/repos/org-repo";
import { createUser, getUserByEmail, updateUser } from "@/lib/repos/user-repo";
import {
  addMember,
  listMembers,
  removeMember,
  updateMemberRole,
} from "@/lib/repos/member-repo";
import {
  createBranch,
  getBranch,
  listBranches,
  updateBranch,
} from "@/lib/repos/branch-repo";
import { listAuditLogs, recordAudit } from "@/lib/repos/audit-repo";
import { OrgScopeError } from "@/lib/org-scope";

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("repos integration", () => {
  const suffix = Date.now().toString(36);
  let orgId = "";
  let ownerId = "";
  let outsiderId = "";
  let nobodyId = "";

  itDb("org/member/branch/audit roundtrip", async () => {
    const owner = await createUser({
      workosUserId: `it-owner-${suffix}`,
      email: `it-owner-${suffix}@test.id`,
    });
    ownerId = owner.id;

    expect((await getUserByEmail(owner.email))?.id).toBe(ownerId);
    expect((await updateUser(ownerId, { name: "Pemilik IT" })).name).toBe(
      "Pemilik IT",
    );

    const org = await createOrg(
      { name: "IT Org", slug: `it-org-${suffix}` },
      ownerId,
    );
    orgId = org.id;
    expect((await getOrgBySlug(`it-org-${suffix}`))?.id).toBe(orgId);

    const outsider = await createUser({
      workosUserId: `it-out-${suffix}`,
      email: `it-out-${suffix}@test.id`,
    });
    outsiderId = outsider.id;

    // member add + role guard: non-member cannot add
    await addMember(ownerId, orgId, outsiderId, "member");
    await expect(
      addMember(outsiderId, orgId, outsiderId, "admin"),
    ).rejects.toThrow(OrgScopeError);

    // cross-org guard: user without membership gets NO_MEMBERSHIP
    const nobody = await createUser({
      workosUserId: `it-nobody-${suffix}`,
      email: `it-nobody-${suffix}@test.id`,
    });
    nobodyId = nobody.id;
    await expect(createBranch(nobody.id, orgId, { name: "x" })).rejects.toThrow(
      OrgScopeError,
    );

    // privilege escalation: admin cannot mint an owner; owner can
    await addMember(ownerId, orgId, nobodyId, "member");
    await updateMemberRole(ownerId, orgId, nobodyId, "admin");
    await expect(addMember(nobodyId, orgId, nobodyId, "owner")).rejects.toThrow(
      OrgScopeError,
    );
    await updateMemberRole(ownerId, orgId, nobodyId, "owner");

    // last-owner guard: dengan 2 owner, demote satu sah
    await updateMemberRole(ownerId, orgId, nobodyId, "member");
    // kini ownerId satu-satunya owner: demote/remove ditolak
    await expect(
      updateMemberRole(ownerId, orgId, ownerId, "member"),
    ).rejects.toThrow(/owner/i);
    await expect(removeMember(ownerId, orgId, ownerId)).rejects.toThrow(
      /owner/i,
    );

    const members = await listMembers(orgId);
    expect(members).toHaveLength(3); // owner, outsider, nobody

    // branch
    const branch = await createBranch(ownerId, orgId, { name: "Pusat IT" });
    expect((await listBranches(orgId)).map((b) => b.name)).toContain(
      "Pusat IT",
    );
    expect((await getBranch(orgId, branch.id))?.name).toBe("Pusat IT");
    expect(
      await getBranch(orgId, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
    const renamed = await updateBranch(ownerId, orgId, branch.id, {
      address: "Jl. Jend. Sudirman No. 1",
    });
    expect(renamed.address).toBe("Jl. Jend. Sudirman No. 1");

    // audit
    await recordAudit({
      orgId,
      userId: ownerId,
      action: "it.test",
      entity: "branch",
      entityId: branch.id,
    });
    const logs = await listAuditLogs(ownerId, orgId);
    expect(logs.some((l) => l.action === "it.test")).toBe(true);

    // non-member (ghost, tanpa membership) tidak boleh baca audit
    const ghost = await createUser({
      workosUserId: `it-ghost-${suffix}`,
      email: `it-ghost-${suffix}@test.id`,
    });
    await expect(listAuditLogs(ghost.id, orgId)).rejects.toThrow(OrgScopeError);
    await db.delete(users).where(eq(users.id, ghost.id));
  });

  itDb("cleanup", async () => {
    if (!orgId) return;
    // Raw delete: guardLastOwner memblokir removeMember untuk sole owner.
    await db.delete(orgMemberships).where(eq(orgMemberships.orgId, orgId));
    await db.delete(users).where(eq(users.id, ownerId));
    await db.delete(users).where(eq(users.id, outsiderId));
    await db.delete(users).where(eq(users.id, nobodyId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });
});
