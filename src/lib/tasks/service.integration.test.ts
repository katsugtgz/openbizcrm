import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, asc, and } from "drizzle-orm";
import { organizations, tasks as tasksTable } from "@/db/schema";
import type { TaskStatus } from "@/lib/tasks/service";

// Integration: RUN_DB_TESTS=1 + live DB. Pin cubic P1 tasks:222 —
// reorder lintas kolom harus persist position kolom tujuan (termasuk task
// yang dipindah) DAN renumber kolom asal.
const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("tasks reorder integration", () => {
  const suffix = Date.now().toString(36);
  const createdOrgIds: string[] = [];
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
  });

  itDb(
    "cross-column move: target renumbered incl. moved task, source renumbered",
    async () => {
      const user = await userRepo.createUser({
        workosUserId: `it-reorder-${suffix}`,
        email: `it-reorder-${suffix}@test.id`,
      });
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
});
