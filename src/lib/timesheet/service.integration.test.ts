import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { organizations, tasks, users } from "@/db/schema";
import { OrgScopeError } from "@/lib/org-scope";

// Integration: RUN_DB_TESTS=1 + live DB only. Static imports are deferred to
// beforeAll so the suite stays skippable without DATABASE_URL.
type ProjectRepo = typeof import("@/lib/repos/project-repo");
type TaskService = typeof import("@/lib/tasks/service");
type TimesheetService = typeof import("@/lib/timesheet/service");

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("projects/tasks/timesheet integration", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let projectRepo!: ProjectRepo;
  let taskSvc!: TaskService;
  let tsSvc!: TimesheetService;
  let createUser!: (typeof import("@/lib/repos/user-repo"))["createUser"];
  let createOrg!: (typeof import("@/lib/repos/org-repo"))["createOrg"];
  let addMember!: (typeof import("@/lib/repos/member-repo"))["addMember"];

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    projectRepo = await import("@/lib/repos/project-repo");
    taskSvc = await import("@/lib/tasks/service");
    tsSvc = await import("@/lib/timesheet/service");
    ({ createUser } = await import("@/lib/repos/user-repo"));
    ({ createOrg } = await import("@/lib/repos/org-repo"));
    ({ addMember } = await import("@/lib/repos/member-repo"));
  });

  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    for (const id of createdOrgIds) {
      // cascades projects/tasks/timesheets
      await db.delete(organizations).where(eq(organizations.id, id));
    }
    for (const id of createdUserIds) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  itDb("project code auto-gen + crud + audit", async () => {
    const owner = await createUser({
      workosUserId: `it-prj-owner-${suffix}`,
      email: `it-prj-owner-${suffix}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await createOrg(
      { name: "Proj Org", slug: `it-prj-${suffix}` },
      owner.id,
    );
    createdOrgIds.push(org.id);

    const p1 = await projectRepo.createProject(owner.id, org.id, {
      name: "Website Company Profile",
    });
    expect(p1.code).toBe("PRJ-001");
    const p2 = await projectRepo.createProject(owner.id, org.id, {
      name: "Integrasi Pembayaran",
    });
    expect(p2.code).toBe("PRJ-002");

    const updated = await projectRepo.updateProject(owner.id, org.id, p1.id, {
      status: "active",
    });
    expect(updated.status).toBe("active");

    // member tak boleh create project
    const member = await createUser({
      workosUserId: `it-prj-m-${suffix}`,
      email: `it-prj-m-${suffix}@test.id`,
    });
    createdUserIds.push(member.id);
    await addMember(owner.id, org.id, member.id, "member");
    await expect(
      projectRepo.createProject(member.id, org.id, { name: "X" }),
    ).rejects.toThrow(OrgScopeError);

    await projectRepo.deleteProject(owner.id, org.id, p2.id);
    const remaining = await projectRepo.listProjects(org.id);
    expect(remaining.map((p) => p.code)).toEqual(["PRJ-001"]);
  });

  itDb(
    "timer start/stop minutes + one-open-timer constraint + org isolation",
    async () => {
      const owner = await createUser({
        workosUserId: `it-ts-owner-${suffix}`,
        email: `it-ts-owner-${suffix}@test.id`,
      });
      createdUserIds.push(owner.id);
      const org = await createOrg(
        { name: "TS Org", slug: `it-ts-${suffix}` },
        owner.id,
      );
      createdOrgIds.push(org.id);
      const otherOwner = await createUser({
        workosUserId: `it-ts-other-${suffix}`,
        email: `it-ts-other-${suffix}@test.id`,
      });
      createdUserIds.push(otherOwner.id);
      const otherOrg = await createOrg(
        { name: "TS Other", slug: `it-ts-o-${suffix}` },
        otherOwner.id,
      );
      createdOrgIds.push(otherOrg.id);

      const project = await projectRepo.createProject(owner.id, org.id, {
        name: "Timesheet Project",
      });
      const t1 = await taskSvc.createTask(owner.id, org.id, project.id, {
        title: "Setup repo",
      });
      const t2 = await taskSvc.createTask(owner.id, org.id, project.id, {
        title: "Deploy",
        status: "in_progress",
      });

      // start -> stop => minutes computed (>= 0), endedAt set
      await tsSvc.startTimer(owner.id, org.id, t1.id);
      await expect(tsSvc.startTimer(owner.id, org.id, t2.id)).rejects.toThrow(
        /timer yang berjalan/,
      );
      const stopped = await tsSvc.stopTimer(owner.id, org.id);
      expect(stopped.minutes).toBeGreaterThanOrEqual(0);
      expect(stopped.endedAt).toBeTruthy();
      await expect(tsSvc.stopTimer(owner.id, org.id)).rejects.toThrow(
        /Tidak ada timer/,
      );

      // task milik org lain tidak bisa di-timer dari org ini:
      // otherOwner member otherOrg tapi task tetap NotFound (org guard task,
      // bukan cuma membership — cubic P2 ts-test:141).
      await expect(
        tsSvc.startTimer(otherOwner.id, otherOrg.id, t1.id),
      ).rejects.toThrow(/Task tidak ditemukan/);

      const year = new Date().getUTCFullYear();
      const rows = await tsSvc.listMine(owner.id, org.id, {
        from: `${year}-01-01`,
        to: `${year}-12-31`,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].taskId).toBe(t1.id);

      const summary = await tsSvc.summaryByProject(
        owner.id,
        org.id,
        project.id,
        {
          from: `${year}-01-01`,
          to: `${year}-12-31`,
        },
      );
      expect(summary.projectId).toBe(project.id);
      expect(summary.totalMinutes).toBe(stopped.minutes ?? 0);
    },
  );

  itDb(
    "reorder keeps others' relative order, within + between columns, org-scoped",
    async () => {
      const owner = await createUser({
        workosUserId: `it-ro-owner-${suffix}`,
        email: `it-ro-owner-${suffix}@test.id`,
      });
      createdUserIds.push(owner.id);
      const org = await createOrg(
        { name: "RO Org", slug: `it-ro-${suffix}` },
        owner.id,
      );
      createdOrgIds.push(org.id);
      const otherOwner = await createUser({
        workosUserId: `it-ro-other-${suffix}`,
        email: `it-ro-other-${suffix}@test.id`,
      });
      createdUserIds.push(otherOwner.id);
      const otherOrg = await createOrg(
        { name: "RO Other", slug: `it-ro-o-${suffix}` },
        otherOwner.id,
      );
      createdOrgIds.push(otherOrg.id);

      const project = await projectRepo.createProject(owner.id, org.id, {
        name: "Reorder Project",
      });
      const a = await taskSvc.createTask(owner.id, org.id, project.id, {
        title: "A",
      });
      const b = await taskSvc.createTask(owner.id, org.id, project.id, {
        title: "B",
      });
      const c = await taskSvc.createTask(owner.id, org.id, project.id, {
        title: "C",
      });

      // within: A ke akhir -> B, C, A
      await taskSvc.reorderTask(owner.id, org.id, a.id, "todo", 2);
      let col = await db
        .select({
          id: tasks.id,
          status: tasks.status,
          position: tasks.position,
        })
        .from(tasks)
        .where(eq(tasks.projectId, project.id))
        .orderBy(tasks.position);
      expect(col.map((t) => t.id)).toEqual([b.id, c.id, a.id]);
      expect(col.map((t) => t.position)).toEqual([0, 1, 2]);

      // between: C ke in_progress index 0
      await taskSvc.reorderTask(owner.id, org.id, c.id, "in_progress", 0);
      col = await db
        .select({
          id: tasks.id,
          status: tasks.status,
          position: tasks.position,
        })
        .from(tasks)
        .where(eq(tasks.projectId, project.id))
        .orderBy(tasks.status, tasks.position);
      const todo = col.filter((t) => t.status === "todo");
      const inprog = col.filter((t) => t.status === "in_progress");
      expect(todo.map((t) => t.id)).toEqual([b.id, a.id]);
      expect(inprog.map((t) => t.id)).toEqual([c.id]);

      // org isolation: task org lain tak terlihat / tak bisa reorder
      await expect(
        taskSvc.reorderTask(owner.id, otherOrg.id, a.id, "done", 0),
      ).rejects.toThrow(OrgScopeError);
    },
  );
});
