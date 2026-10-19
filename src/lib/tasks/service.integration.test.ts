import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, asc, and, sql, inArray } from "drizzle-orm";
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
    "reorder vs concurrent delete: clean error, positions not corrupted",
    async () => {
      // Pin cubic P2 tasks:277 — delete antara snapshot dan persist tidak
      // boleh meninggalkan position korup; delete sendiri serialized pada
      // project lock yang sama.
      const user = await userRepo.createUser({
        workosUserId: `it-reorder-del-${suffix}`,
        email: `it-reorder-del-${suffix}@test.id`,
      });
      createdUserIds.push(user.id);
      const org = await orgRepo.createOrg(
        { name: "ReorderDel Org", slug: `it-reorder-del-${suffix}` },
        user.id,
      );
      createdOrgIds.push(org.id);
      const project = await projectRepo.createProject(user.id, org.id, {
        name: "ReorderDel Project",
      });
      const a = await taskSvc.createTask(user.id, org.id, project.id, {
        title: "A",
      });
      const b = await taskSvc.createTask(user.id, org.id, project.id, {
        title: "B",
      });
      const c = await taskSvc.createTask(user.id, org.id, project.id, {
        title: "C",
      });

      // Hapus A, lalu reorder A (task yang sudah hilang). Harus error bersih
      // (NotFoundError / basi), B & C tidak tersentuh.
      await taskSvc.deleteTask(user.id, org.id, a.id);
      // Pre-read: NotFoundError bersih (bukan position korup).
      await expect(
        taskSvc.reorderTask(user.id, org.id, a.id, "in_progress", 0),
      ).rejects.toThrow(/tidak ditemukan|basi/i);
      const pos = await db
        .select({ id: tasksTable.id, position: tasksTable.position })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.orgId, org.id),
            eq(tasksTable.projectId, project.id),
          ),
        )
        .orderBy(asc(tasksTable.position));
      // Delete tidak renumber (posisi lama dipertahankan), tapi konsisten
      // dan unik — tidak korup.
      expect(pos).toEqual([
        { id: b.id, position: 1 },
        { id: c.id, position: 2 },
      ]);

      // Delete saat reorder berjalan: delete di-serialize pada project lock —
      // sukses dan kolom konsisten (reorder lanjutan tidak melihat ghost).
      const d = await taskSvc.createTask(user.id, org.id, project.id, {
        title: "D",
      });
      await taskSvc.reorderTask(user.id, org.id, b.id, "in_progress", 0);
      await taskSvc.deleteTask(user.id, org.id, d.id);
      const pos2 = await db
        .select({
          id: tasksTable.id,
          status: tasksTable.status,
          position: tasksTable.position,
        })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.orgId, org.id),
            eq(tasksTable.projectId, project.id),
          ),
        )
        .orderBy(asc(tasksTable.position));
      // B pindah ke in_progress pos 0; C todo pos 0; D hilang.
      expect(pos2.filter((r) => r.id === b.id)).toEqual([
        { id: b.id, status: "in_progress", position: 0 },
      ]);
      expect(pos2.filter((r) => r.id === c.id)).toEqual([
        { id: c.id, status: "todo", position: 0 },
      ]);
      expect(pos2.find((r) => r.id === d.id)).toBeUndefined();
    },
  );

  itDb(
    "reorder audit 'from' reflects in-lock reread, not pre-read",
    async () => {
      // Pin cubic P2 tasks:328 — audit metadata.from harus status terkunci,
      // bukan snapshot pre-lock.
      const user = await userRepo.createUser({
        workosUserId: `it-audit-${suffix}`,
        email: `it-audit-${suffix}@test.id`,
      });
      createdUserIds.push(user.id);
      const org = await orgRepo.createOrg(
        { name: "Audit Org", slug: `it-audit-${suffix}` },
        user.id,
      );
      createdOrgIds.push(org.id);
      const project = await projectRepo.createProject(user.id, org.id, {
        name: "Audit Project",
      });
      const t = await taskSvc.createTask(user.id, org.id, project.id, {
        title: "T",
      });
      const { auditLogs } = await import("@/db/schema");
      await taskSvc.reorderTask(user.id, org.id, t.id, "done", 0);
      const [log] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.orgId, org.id),
            eq(auditLogs.entityId, t.id),
            eq(auditLogs.action, "task.reorder"),
          ),
        )
        .orderBy(asc(auditLogs.createdAt));
      expect(log.metadata).toMatchObject({ from: "todo", to: "done" });
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
  //
  // CATATAN (cubic P2 tasks-test:196/:235): test ini ALGORITMA-test — SQL di
  // bawah meniru langkah backfill+dedupe 0014, bukan file drizzle/0014 itu
  // sendiri (mengeksekusi file SQL mentah ke DB yang dikelola drizzle di luar
  // scope; cek verbatim dilakukan di test 0015 di bawah). Drop index di tengah
  // test diselamatkan lewat finally: CREATE INDEX ulang dipanggil walau
  // assertion gagal, supaya schema bersama tak rusak untuk test berikutnya.
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
      // berbeda (cubic schema.ts:449). DROP masuk blok try/finally — index
      // dibuat ulang walau assertion gagal (cubic P2 tasks-test:196), schema
      // bersama tidak boleh rusak untuk test berikutnya.
      await db.execute(
        sql`drop index if exists tasks_org_project_daily_title_unique`,
      );
      try {
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
        expect(dupRows.map((r) => r.source).sort()).toEqual([
          "daily",
          "manual",
        ]);
        expect(after.find((r) => r.title === "legacy")?.source).toBe("daily");

        // Langkah (d): index dibuat ulang — dedupe di atas harus membuatnya
        // valid (kalau tidak, CREATE INDEX gagal dan test merah).
        await db.execute(sql`
          create unique index tasks_org_project_daily_title_unique
          on tasks (org_id, project_id, daily_for_date, title)
          where source = 'daily'
        `);
      } finally {
        await db.execute(sql`
          create unique index if not exists tasks_org_project_daily_title_unique
          on tasks (org_id, project_id, daily_for_date, title)
          where source = 'daily'
        `);
      }
    },
  );

  // Migration 0015 (cubic P1 drizzle/0014:11 + :38): repair DB di mana 0014
  // GAGAL atau ter-apply parsial. SQL dijalankan VERBATIM dari file migrasi
  // (bukan salinan — cubic P2 tasks-test:235), split di marker breakpoint.
  itDb(
    "0015 repairs failed/partial 0014 state, idempotent saat dijalankan ulang",
    async () => {
      const { readFile } = await import("node:fs/promises");
      const user = await userRepo.createUser({
        workosUserId: `it-mig15-${suffix}`,
        email: `it-mig15-${suffix}@test.id`,
      });
      createdUserIds.push(user.id);
      const org = await orgRepo.createOrg(
        { name: "Mig15 Org", slug: `it-mig15-${suffix}` },
        user.id,
      );
      createdOrgIds.push(org.id);
      const project = await projectRepo.createProject(user.id, org.id, {
        name: "Mig15 Project",
      });

      // Seed state pra-0014 yang membuat 0014 abort: index & CHECK harus
      // diturunkan dulu (dup key & daily tanpa tanggal hanya mungkin tanpa
      // keduanya). Migrasi sendiri yang memasang ulang keduanya di langkah (d).
      await db.execute(
        sql`drop index if exists tasks_org_project_daily_title_unique`,
      );
      await db.execute(
        sql`alter table tasks drop constraint if exists tasks_daily_date_required`,
      );
      const today = new Date().toISOString().slice(0, 10);
      await db.insert(tasksTable).values([
        // Daily tanpa tanggal, PUNYA due_date → (b1) tanggal dipulihkan.
        {
          orgId: org.id,
          projectId: project.id,
          title: "repair-me",
          source: "daily" as const,
          dueDate: today,
        },
        // Daily tanpa tanggal, TANPA due_date → (b2) demosi manual.
        {
          orgId: org.id,
          projectId: project.id,
          title: "demote-me",
          source: "daily" as const,
        },
        // Pasangan dup key → (c) keep earliest created_at, loser manual.
        {
          orgId: org.id,
          projectId: project.id,
          title: "dup15",
          source: "daily" as const,
          dailyForDate: today,
        },
        {
          orgId: org.id,
          projectId: project.id,
          title: "dup15",
          source: "daily" as const,
          dailyForDate: today,
        },
      ]);

      // Jalankan migrasi VERBATIM — dua kali untuk membuktikan idempoten.
      const raw = await readFile("drizzle/0015_daily-date-repair.sql", "utf8");
      const statements = raw
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      for (let pass = 0; pass < 2; pass++) {
        for (const stmt of statements) {
          await db.execute(sql.raw(stmt));
        }
      }

      const rows = await db
        .select({
          title: tasksTable.title,
          source: tasksTable.source,
          dailyForDate: tasksTable.dailyForDate,
          dueDate: tasksTable.dueDate,
        })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.orgId, org.id),
            inArray(tasksTable.title, ["repair-me", "demote-me", "dup15"]),
          ),
        )
        .orderBy(asc(tasksTable.title));
      // (b1): daily_for_date dipulihkan dari due_date, tetap daily.
      expect(rows.find((r) => r.title === "repair-me")).toEqual({
        title: "repair-me",
        source: "daily",
        dailyForDate: today,
        dueDate: today,
      });
      // (b2): tanpa due_date → demosi manual, daily_for_date NULL.
      expect(rows.find((r) => r.title === "demote-me")).toEqual({
        title: "demote-me",
        source: "manual",
        dailyForDate: null,
        dueDate: null,
      });
      // (c): tepat satu daily tersisa dari pasangan dup.
      const dupRows = rows.filter((r) => r.title === "dup15");
      expect(dupRows.map((r) => r.source).sort()).toEqual(["daily", "manual"]);
      expect(dupRows.find((r) => r.source === "daily")!.dailyForDate).toBe(
        today,
      );

      // (d): CHECK & partial index hidup kembali dan menolak pelanggaran.
      await expect(
        db.execute(sql`
          insert into tasks (org_id, project_id, title, source)
          values (${org.id}, ${project.id}, 'chk15', 'daily')
        `),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint_name: "tasks_daily_date_required" },
      });
      await expect(
        db.execute(sql`
          insert into tasks (org_id, project_id, title, source, daily_for_date)
          values (${org.id}, ${project.id}, 'dup15', 'daily', ${today})
        `),
      ).rejects.toMatchObject({ cause: { code: "23505" } });
    },
  );
});
