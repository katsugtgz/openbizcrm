import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, asc, and } from "drizzle-orm";
import { organizations, tasks as tasksTable, users } from "@/db/schema";
import type { TaskStatus } from "@/lib/tasks/service";

// Integration: RUN_DB_TESTS=1 + live DB. Pin cubic P1 tasks:222 —
// reorder lintas kolom harus persist position kolom tujuan (termasuk task
// yang dipindah) DAN renumber kolom asal.
const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("tasks reorder integration", () => {
  const suffix = Date.now().toString(36);
  const createdOrgIds: string[] = [];
  const createdUserIds: string[] = [];
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let taskSvc!: typeof import("@/lib/tasks/service");
  let projectRepo!: typeof import("@/lib/repos/project-repo");
  let userRepo!: typeof import("@/lib/repos/user-repo");
  let orgRepo!: typeof import("@/lib/repos/org-repo");

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    taskSvc = await import("@/lib/tasks/service");
    projectRepo = await import("@/lib/repos/project-repo");
    userRepo = await import("@/lib/repos/user-repo");
    orgRepo = await import("@/lib/repos/org-repo");
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    for (const id of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
    }
    // User dihapus setelah org — FK memberships/projects menunjuk user.
    for (const id of createdUserIds) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  itDb(
    "cross-column move: target renumbered incl. moved task, source renumbered",
    async () => {
      const user = await userRepo.createUser({
        workosUserId: `it-reorder-${suffix}`,
        email: `it-reorder-${suffix}@test.id`,
      });
      createdUserIds.push(user.id);
      const org = await orgRepo.createOrg(
        { name: "Reorder Org", slug: `it-reorder-${suffix}` },
        user.id,
      );
      createdOrgIds.push(org.id);

      const project = await projectRepo.createProject(user.id, org.id, {
        name: "Reorder Project",
      });
      const a = await taskSvc.createTask(user.id, org.id, project.id, {
        title: "A todo",
      });
      const b = await taskSvc.createTask(user.id, org.id, project.id, {
        title: "B todo",
      });
      const x = await taskSvc.createTask(user.id, org.id, project.id, {
        title: "X in_progress",
        status: "in_progress",
      });

      // Pindahkan A (todo pos 0) ke in_progress index 1 (setelah X).
      await taskSvc.reorderTask(user.id, org.id, a.id, "in_progress", 1);

      const col = (status: TaskStatus) =>
        db
          .select({ id: tasksTable.id, position: tasksTable.position })
          .from(tasksTable)
          .where(
            and(
              eq(tasksTable.orgId, org.id),
              eq(tasksTable.projectId, project.id),
              eq(tasksTable.status, status),
            ),
          )
          .orderBy(asc(tasksTable.position));

      // Kolom tujuan: X tetap 0, A masuk pos 1.
      expect(await col("in_progress")).toEqual([
        { id: x.id, position: 0 },
        { id: a.id, position: 1 },
      ]);
      // Kolom asal renumber 0..n-1 tanpa gap.
      expect(await col("todo")).toEqual([{ id: b.id, position: 0 }]);
    },
  );

  itDb(
    "cycle guard: 40-level chain rejected, tapi chain bebas lewat tanpa cap",
    async () => {
      const user = await userRepo.createUser({
        workosUserId: `it-cycle-${suffix}`,
        email: `it-cycle-${suffix}@test.id`,
      });
      createdUserIds.push(user.id);
      const org = await orgRepo.createOrg(
        { name: "Cycle Org", slug: `it-cycle-${suffix}` },
        user.id,
      );
      createdOrgIds.push(org.id);
      const project = await projectRepo.createProject(user.id, org.id, {
        name: "Cycle Project",
      });

      // Rantai 40 level: t0 <- t1 <- ... <- t39. Melampaui cap 32 lama —
      // guard lama berhenti diam-diam setelah 32 ancestor.
      const t0 = await taskSvc.createTask(user.id, org.id, project.id, {
        title: "t0",
      });
      let tail = t0;
      for (let i = 1; i < 40; i++) {
        tail = await taskSvc.createTask(user.id, org.id, project.id, {
          title: `t${i}`,
          parentId: tail.id,
        });
      }

      // Anak di bawah rantai >= 40 tetap lolos (guard tidak mentok cap).
      const deepChild = await taskSvc.createTask(user.id, org.id, project.id, {
        title: "deep-child",
        parentId: tail.id,
      });
      expect(deepChild.parentId).toBe(tail.id);

      // Cycle via update: jadikan t0 anak deepChild => t0 -> t1 -> … -> t39
      // -> deepChild -> t0. Update t0 harus jalan seluruh rantai >= 40
      // sebelum menemukan cycle — guard lama mentok cap 32 dan lolos diam
      // (cubic P2 tasks-test:140).
      await expect(
        taskSvc.updateTask(user.id, org.id, t0.id, {
          parentId: deepChild.id,
        }),
      ).rejects.toThrow(/turunan/);
    },
  );
});
