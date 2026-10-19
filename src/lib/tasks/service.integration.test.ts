import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, asc, and, sql } from "drizzle-orm";
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

  // Migration 0014 (cubic P1 0012:1 + schema.ts:449): dedupe daily keys dan
  // CHECK source='daily' → daily_for_date NOT NULL. Deadlock-free: uji SQL
  // mentah pada tabel tasks milik org test ini.
  itDb(
    "CHECK tasks_daily_date_required rejects daily row without date",
    async () => {
      const user = await userRepo.createUser({
        workosUserId: `it-chk-${suffix}`,
        email: `it-chk-${suffix}@test.id`,
      });
      createdUserIds.push(user.id);
      const org = await orgRepo.createOrg(
        { name: "Check Org", slug: `it-chk-${suffix}` },
        user.id,
      );
      createdOrgIds.push(org.id);
      const project = await projectRepo.createProject(user.id, org.id, {
        name: "Check Project",
      });

      // daily + tanggal → lolos.
      await db.execute(sql`
        insert into tasks (org_id, project_id, title, source, daily_for_date)
        values (${org.id}, ${project.id}, 'ok-daily', 'daily', current_date)
      `);
      // daily + NULL daily_for_date → CHECK melarang. Drizzle membungkus
      // error postgres (code 23514) jadi "Failed query", jadi match pesan
      // lewat cause, bukan teks luar.
      await expect(
        db.execute(sql`
          insert into tasks (org_id, project_id, title, source)
          values (${org.id}, ${project.id}, 'bad-daily', 'daily')
        `),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint_name: "tasks_daily_date_required" },
      });

      // Dedupe path: kunci harian sama, daily terbaru didemosi jadi manual
      // (keep earliest created_at) — simulasi state pra-0014 di org terpisah.
      const org2 = await orgRepo.createOrg(
        { name: "Dedupe Org", slug: `it-dedupe-${suffix}` },
        user.id,
      );
      createdOrgIds.push(org2.id);
      const project2 = await projectRepo.createProject(user.id, org2.id, {
        name: "Dedupe Project",
      });
      // Seed state pra-dedupe. Partial unique index 0012 harus di-drop dulu:
      // state pra-0012 justru daily duplikat lolos karena NULL dianggap
      // berbeda (cubic schema.ts:449). Index dibuat ulang di akhir test.
      await db.execute(
        sql`drop index if exists tasks_org_project_daily_title_unique`,
      );
      const today = new Date().toISOString().slice(0, 10);
      await db.insert(tasksTable).values([
        // Dua daily kunci SAMA (judul sama, tanggal sama) — hanya mungkin
        // di DB pra-0012 yang NULL/berbeda dianggap beda. created_at beda
        // via dueDate marker di bawah? Tidak: sama persis, pemilih keep
        // pakai (created_at, id); cukup asersi salah satunya daily.
        {
          orgId: org2.id,
          projectId: project2.id,
          title: "dup",
          source: "daily" as const,
          dailyForDate: today,
          dueDate: today,
        },
        {
          orgId: org2.id,
          projectId: project2.id,
          title: "dup",
          source: "daily" as const,
          dailyForDate: today,
          dueDate: today,
        },
        {
          orgId: org2.id,
          projectId: project2.id,
          title: "legacy",
          source: "manual" as const,
          dueDate: today,
        },
      ]);
      const seededCount = await db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(eq(tasksTable.orgId, org2.id));
      expect(seededCount).toHaveLength(3);
      // Langkah (b) 0014: legacy manual+due_date balik jadi daily.
      await db.execute(sql`
        update tasks as t
        set source = 'daily', daily_for_date = t.due_date
        where t.source = 'manual' and t.due_date is not null
          and not exists (
            select 1 from tasks as d
            where d.org_id = t.org_id and d.project_id = t.project_id
              and d.daily_for_date is not distinct from t.due_date
              and d.title = t.title and d.source = 'daily'
          )
      `);
      // Langkah (a) 0014: dedupe keep-earliest.
      await db.execute(sql`
        update tasks as loser
        set source = 'manual', daily_for_date = null
        from tasks as keep
        where loser.org_id = keep.org_id
          and loser.project_id = keep.project_id
          and loser.daily_for_date is not distinct from keep.daily_for_date
          and loser.title = keep.title
          and loser.source = 'daily' and keep.source = 'daily'
          and (loser.created_at, loser.id) > (keep.created_at, keep.id)
      `);
      const after = await db
        .select({ title: tasksTable.title, source: tasksTable.source })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.orgId, org2.id),
            sql`${tasksTable.title} in ('dup', 'legacy')`,
          ),
        )
        .orderBy(asc(tasksTable.title), asc(tasksTable.createdAt));
      // 'legacy' backfill (b) → daily. Dedupe (a) keep-earliest: tepat satu
      // baris 'dup' tetap daily, satunya didemosi manual.
      const dupRows = after.filter((r) => r.title === "dup");
      expect(dupRows).toHaveLength(2);
      expect(dupRows.map((r) => r.source).sort()).toEqual(["daily", "manual"]);
      expect(after.find((r) => r.title === "legacy")?.source).toBe("daily");

      // Langkah (d): index dibuat ulang — dedupe di atas harus membuatnya
      // valid (kalau tidak, CREATE INDEX gagal dan test merah).
      await db.execute(sql`
        create unique index tasks_org_project_daily_title_unique
        on tasks (org_id, project_id, daily_for_date, title)
        where source = 'daily'
      `);
    },
  );
});
