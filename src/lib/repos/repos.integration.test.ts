import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import {
  approvalRequests,
  orgMemberships,
  organizations,
  users,
} from "@/db/schema";
import { OrgScopeError } from "@/lib/org-scope";
import { NotFoundError, UUIDContractError } from "@/lib/org-scope";
import { createApproval } from "@/lib/approval";

// DB-touching modules load ONLY when RUN_DB_TESTS=1: a static top-level
// @/db import would initialize the database stack even when the suite is
// skipped (cubic P2 repos.integration.test.ts:4).
type OrgRepo = typeof import("@/lib/repos/org-repo");
type UserRepo = typeof import("@/lib/repos/user-repo");
type MemberRepo = typeof import("@/lib/repos/member-repo");
type BranchRepo = typeof import("@/lib/repos/branch-repo");
type AuditRepo = typeof import("@/lib/repos/audit-repo");
type ApprovalStore = typeof import("@/lib/approval/store");

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("repos integration", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let createOrg!: OrgRepo["createOrg"];
  let getOrgBySlug!: OrgRepo["getOrgBySlug"];
  let updateOrg!: OrgRepo["updateOrg"];
  let createUser!: UserRepo["createUser"];
  let getUserByEmail!: UserRepo["getUserByEmail"];
  let updateUser!: UserRepo["updateUser"];
  let addMember!: MemberRepo["addMember"];
  let LastOwnerError!: MemberRepo["LastOwnerError"];
  let listMembers!: MemberRepo["listMembers"];
  let removeMember!: MemberRepo["removeMember"];
  let updateMemberRole!: MemberRepo["updateMemberRole"];
  let createBranch!: BranchRepo["createBranch"];
  let getBranch!: BranchRepo["getBranch"];
  let listBranches!: BranchRepo["listBranches"];
  let updateBranch!: BranchRepo["updateBranch"];
  let listAuditLogs!: AuditRepo["listAuditLogs"];
  let recordAudit!: AuditRepo["recordAudit"];
  let ApprovalNotFoundError!: ApprovalStore["ApprovalNotFoundError"];
  let saveApprovalRequest!: ApprovalStore["saveApprovalRequest"];
  let getApprovalRequest!: ApprovalStore["getApprovalRequest"];
  let getApprovalRequestByRowId!: ApprovalStore["getApprovalRequestByRowId"];

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    ({ createOrg, getOrgBySlug, updateOrg } =
      await import("@/lib/repos/org-repo"));
    ({ createUser, getUserByEmail, updateUser } =
      await import("@/lib/repos/user-repo"));
    ({
      addMember,
      LastOwnerError,
      listMembers,
      removeMember,
      updateMemberRole,
    } = await import("@/lib/repos/member-repo"));
    ({ createBranch, getBranch, listBranches, updateBranch } =
      await import("@/lib/repos/branch-repo"));
    ({ listAuditLogs, recordAudit } = await import("@/lib/repos/audit-repo"));
    ({
      ApprovalNotFoundError,
      saveApprovalRequest,
      getApprovalRequest,
      getApprovalRequestByRowId,
    } = await import("@/lib/approval/store"));
  });

  // Every created resource is registered at creation time so cleanup deletes
  // each one independently of orgId — a roundtrip failing midway must not
  // leak rows (cubic P2 repos.integration.test.ts:129). Organizations first:
  // memberships/approvals/employees cascade off them.
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];
  const trackUser = (id: string) => createdUserIds.push(id);

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    for (const orgId of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
    }
    for (const userId of createdUserIds) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  itDb("org/member/branch/audit roundtrip", async () => {
    const owner = await createUser({
      workosUserId: `it-owner-${suffix}`,
      email: `it-owner-${suffix}@test.id`,
    });
    trackUser(owner.id);

    expect((await getUserByEmail(owner.email))?.id).toBe(owner.id);
    expect((await updateUser(owner.id, { name: "Pemilik IT" })).name).toBe(
      "Pemilik IT",
    );

    const org = await createOrg(
      { name: "IT Org", slug: `it-org-${suffix}` },
      owner.id,
    );
    createdOrgIds.push(org.id);
    expect((await getOrgBySlug(`it-org-${suffix}`))?.id).toBe(org.id);

    const outsider = await createUser({
      workosUserId: `it-out-${suffix}`,
      email: `it-out-${suffix}@test.id`,
    });
    trackUser(outsider.id);

    // ghost: a user with no membership anywhere, used for cross-role checks
    const ghost = await createUser({
      workosUserId: `it-ghost-${suffix}`,
      email: `it-ghost-${suffix}@test.id`,
    });
    trackUser(ghost.id);

    // member add + role guard: non-member cannot add
    await addMember(owner.id, org.id, outsider.id, "member");
    await expect(
      addMember(outsider.id, org.id, outsider.id, "admin"),
    ).rejects.toThrow(OrgScopeError);

    // cross-org guard: user without membership gets NO_MEMBERSHIP
    const nobody = await createUser({
      workosUserId: `it-nobody-${suffix}`,
      email: `it-nobody-${suffix}@test.id`,
    });
    trackUser(nobody.id);
    await expect(
      createBranch(nobody.id, org.id, { name: "x" }),
    ).rejects.toThrow(OrgScopeError);

    // privilege escalation: admin cannot mint an owner; owner can
    await addMember(owner.id, org.id, nobody.id, "member");
    await updateMemberRole(owner.id, org.id, nobody.id, "admin");
    await expect(
      addMember(nobody.id, org.id, nobody.id, "owner"),
    ).rejects.toThrow(OrgScopeError);
    await updateMemberRole(owner.id, org.id, nobody.id, "owner");

    // last-owner guard: dengan 2 owner, demote satu sah
    await updateMemberRole(owner.id, org.id, nobody.id, "member");
    // kini ownerId satu-satunya owner: demote/remove ditolak
    await expect(
      updateMemberRole(owner.id, org.id, owner.id, "member"),
    ).rejects.toThrow(/owner/i);
    await expect(removeMember(owner.id, org.id, owner.id)).rejects.toThrow(
      /owner/i,
    );

    const members = await listMembers(owner.id, org.id);
    expect(members).toHaveLength(3); // owner, outsider, nobody

    // branch: reads need membership, writes need admin
    const branch = await createBranch(owner.id, org.id, { name: "Pusat IT" });
    expect((await listBranches(owner.id, org.id)).map((b) => b.name)).toContain(
      "Pusat IT",
    );
    expect((await getBranch(owner.id, org.id, branch.id))?.name).toBe(
      "Pusat IT",
    );
    expect(
      await getBranch(owner.id, org.id, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
    const renamed = await updateBranch(owner.id, org.id, branch.id, {
      address: "Jl. Jend. Sudirman No. 1",
    });
    expect(renamed.address).toBe("Jl. Jend. Sudirman No. 1");

    // member cannot manage branch structure; outsider cannot even read
    const memberUser = await createUser({
      workosUserId: `it-member-${suffix}`,
      email: `it-member-${suffix}@test.id`,
    });
    trackUser(memberUser.id);
    await addMember(owner.id, org.id, memberUser.id, "member");
    await expect(
      createBranch(memberUser.id, org.id, { name: "Cabang Member" }),
    ).rejects.toThrow(/INSUFFICIENT_ROLE|Peran/);
    await expect(
      updateBranch(memberUser.id, org.id, branch.id, { name: "x" }),
    ).rejects.toThrow(/INSUFFICIENT_ROLE|Peran/);
    // member can read; non-member cannot
    expect((await listBranches(memberUser.id, org.id)).length).toBe(1);
    await expect(listBranches(ghost.id, org.id)).rejects.toThrow(OrgScopeError);
    await expect(getBranch(ghost.id, org.id, branch.id)).rejects.toThrow(
      OrgScopeError,
    );

    // stale/foreign branch id is NotFound, not NO_MEMBERSHIP
    await expect(
      updateBranch(owner.id, org.id, "00000000-0000-0000-0000-000000000000", {
        name: "y",
      }),
    ).rejects.toThrow(NotFoundError);

    // audit
    await recordAudit({
      orgId: org.id,
      userId: owner.id,
      action: "it.test",
      entity: "branch",
      entityId: branch.id,
    });
    const logs = await listAuditLogs(owner.id, org.id);
    expect(logs.some((l) => l.action === "it.test")).toBe(true);

    // non-member (ghost, tanpa membership) tidak boleh baca audit
    await expect(listAuditLogs(ghost.id, org.id)).rejects.toThrow(
      OrgScopeError,
    );
    // audit attribution: a non-member org/user pair must be rejected, not
    // silently recorded under someone else's tenant history
    await expect(
      recordAudit({
        orgId: org.id,
        userId: ghost.id,
        action: "it.forged",
      }),
    ).rejects.toThrow(OrgScopeError);
  });

  itDb(
    "approval store: org-scoped reads/upserts + UUID contract on requireOrgRole",
    async () => {
      const owner = await createUser({
        workosUserId: `it-appr-owner-${suffix}`,
        email: `it-appr-owner-${suffix}@test.id`,
      });
      trackUser(owner.id);
      const otherOwner = await createUser({
        workosUserId: `it-appr-other-${suffix}`,
        email: `it-appr-other-${suffix}@test.id`,
      });
      trackUser(otherOwner.id);
      const org = await createOrg(
        { name: "Appr Org", slug: `it-appr-${suffix}` },
        owner.id,
      );
      createdOrgIds.push(org.id);
      const otherOrg = await createOrg(
        { name: "Appr Other", slug: `it-appr-other-${suffix}` },
        otherOwner.id,
      );
      createdOrgIds.push(otherOrg.id);

      // owner saves an approval in its org
      const req = createApproval({
        requestId: `APR-${suffix}`,
        requestedBy: owner.id,
        chain: [{ approverId: otherOwner.id }],
      });
      const saved = await saveApprovalRequest(org.id, req);

      // same requestId saved under the OTHER org is a distinct row
      const otherSaved = await saveApprovalRequest(otherOrg.id, req);
      expect(otherSaved.id).not.toBe(saved.id);

      // reads are org-scoped: same requestId resolves per org
      expect((await getApprovalRequest(org.id, req.requestId))?.requestId).toBe(
        req.requestId,
      );
      const [orgRow] = await db
        .select({ organizationId: approvalRequests.organizationId })
        .from(approvalRequests)
        .where(eq(approvalRequests.id, otherSaved.id));
      expect(orgRow.organizationId).toBe(otherOrg.id);

      // cross-org row-id lookup is NotFound, not a silent leak
      await expect(
        getApprovalRequestByRowId(otherOrg.id, saved.id),
      ).rejects.toThrow(ApprovalNotFoundError);
      // correct org resolves fine
      expect(
        (await getApprovalRequestByRowId(org.id, saved.id)).requestId,
      ).toBe(req.requestId);

      // requireOrgRole UUID contract: WorkOS-shaped IDs fail loudly
      await expect(
        (async () => {
          const { requireOrgRole } = await import("@/lib/org-scope");
          await requireOrgRole("user_01HXYZ", org.id, "member");
        })(),
      ).rejects.toThrow(UUIDContractError);
      await expect(
        (async () => {
          const { requireOrgRole } = await import("@/lib/org-scope");
          await requireOrgRole(owner.id, "org_01HXYZ", "member");
        })(),
      ).rejects.toThrow(UUIDContractError);
      // valid UUIDs still pass through the normal membership path
      await expect(
        (async () => {
          const { requireOrgRole } = await import("@/lib/org-scope");
          return requireOrgRole(owner.id, org.id, "owner");
        })(),
      ).resolves.toMatchObject({ role: "owner" });
    },
  );

  itDb(
    "atomicity + not-found + uniqueness: createOrg rollback, email unique, listMembers guard, updateOrg/updateUser NotFound",
    async () => {
      // createOrg atomicity: a bogus owner id must roll back the org insert,
      // so the slug stays free for a retry instead of being stuck ownerless
      const deadOwnerId = "11111111-1111-1111-1111-111111111111";
      await expect(
        createOrg(
          { name: "Orphan Org", slug: `it-orphan-${suffix}` },
          deadOwnerId,
        ),
      ).rejects.toThrow();
      expect(await getOrgBySlug(`it-orphan-${suffix}`)).toBeNull();

      // email uniqueness (migration 0004): duplicate email insert is rejected
      const email = `it-dup-${suffix}@test.id`;
      const first = await createUser({
        workosUserId: `it-dup-a-${suffix}`,
        email,
      });
      trackUser(first.id);
      await expect(
        createUser({ workosUserId: `it-dup-b-${suffix}`, email }),
      ).rejects.toThrow();

      // updateUser NotFound: missing id throws instead of returning undefined
      await expect(
        updateUser("22222222-2222-2222-2222-222222222222", { name: "x" }),
      ).rejects.toThrow(NotFoundError);

      // updateOrg missing id: the actor guard fires first — a missing org
      // has no membership row, so NO_MEMBERSHIP precedes the row-level
      // NotFoundError (which remains as defense-in-depth for the
      // deleted-between-guard-and-update race).
      await expect(
        updateOrg(first.id, "33333333-3333-4333-8333-333333333333", {
          name: "x",
        }),
      ).rejects.toThrow(OrgScopeError);

      // updateOrg actor guard: non-member caller cannot rename another tenant
      // (cubic P1 org-repo:36). outsider has no membership in any org here.
      const outsider = await createUser({
        workosUserId: `it-uo-${suffix}`,
        email: `it-uo-${suffix}@test.id`,
      });
      trackUser(outsider.id);
      await expect(
        updateOrg(outsider.id, first.id, { name: "hijack" }),
      ).rejects.toThrow(OrgScopeError);

      // listMembers: non-member cannot enumerate member PII
      const owner = await createUser({
        workosUserId: `it-lm-owner-${suffix}`,
        email: `it-lm-owner-${suffix}@test.id`,
      });
      trackUser(owner.id);
      const org = await createOrg(
        { name: "LM Org", slug: `it-lm-${suffix}` },
        owner.id,
      );
      createdOrgIds.push(org.id);
      // A UUID that fails the v4 shape check trips UUIDContractError before
      // membership is even queried; a well-formed non-member gets OrgScopeError.
      await expect(
        listMembers("99999999-9999-4999-8999-999999999999", org.id),
      ).rejects.toThrow(OrgScopeError);
      await expect(listMembers("not-a-uuid", org.id)).rejects.toThrow(
        UUIDContractError,
      );
      const members = await listMembers(owner.id, org.id);
      expect(members).toHaveLength(1);

      // last-owner demotion is still blocked inside the transactional path
      await expect(
        updateMemberRole(owner.id, org.id, owner.id, "member"),
      ).rejects.toThrow(LastOwnerError);
    },
  );

  itDb(
    "last-owner guard is concurrency-safe: only one of two parallel demotions wins",
    async () => {
      const ownerA = await createUser({
        workosUserId: `it-race-a-${suffix}`,
        email: `it-race-a-${suffix}@test.id`,
      });
      trackUser(ownerA.id);
      const ownerB = await createUser({
        workosUserId: `it-race-b-${suffix}`,
        email: `it-race-b-${suffix}@test.id`,
      });
      trackUser(ownerB.id);
      const org = await createOrg(
        { name: "Race Org", slug: `it-race-${suffix}` },
        ownerA.id,
      );
      createdOrgIds.push(org.id);
      await addMember(ownerA.id, org.id, ownerB.id, "owner");
      const ownersBefore = await db
        .select()
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.orgId, org.id),
            eq(orgMemberships.role, "owner"),
          ),
        );
      expect(ownersBefore).toHaveLength(2);

      // Two owners demote each other simultaneously. FOR UPDATE row locks
      // serialize guardLastOwner: exactly one demotion succeeds, the org is
      // never left with zero owners.
      const results = await Promise.allSettled([
        updateMemberRole(ownerA.id, org.id, ownerB.id, "member"),
        updateMemberRole(ownerB.id, org.id, ownerA.id, "member"),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(1);

      const remainingOwners = await db
        .select({ userId: orgMemberships.userId })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.orgId, org.id),
            eq(orgMemberships.role, "owner"),
          ),
        );
      expect(remainingOwners).toHaveLength(1);
    },
  );
});
