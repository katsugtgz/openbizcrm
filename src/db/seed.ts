import "dotenv/config";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  announcements,
  auditLogs,
  branches,
  courseCompletions,
  courseMaterials,
  courses,
  crmActivities,
  crmCompanies,
  crmContacts,
  crmDeals,
  crmPipelines,
  crmStages,
  organizations,
  orgMemberships,
  projects,
  reviewAssignments,
  reviewForms,
  reviewPeriods,
  reviewResponses,
  taskTemplates,
  tasks,
  timesheets,
  users,
} from "@/db/schema";
import { DEFAULT_STAGE_NAMES } from "@/lib/repos/crm-repo";

const ORG_NAME = "PT Contoh Sejahtera";
const ORG_SLUG = "contoh-sejahtera";
// WorkOS org id pengganti: resolver auth boundary (src/lib/auth/ids.ts) dan
// integration test memakai ini untuk memetakan session.organizationId ->
// organizations.id. Deterministik supaya seed idempotent.
const ORG_WORKOS_ID = "org_contoh-sejahtera";

/**
 * Seed plants deterministic privileged rows (owner/admin/member + org). Refuse
 * to run against a production environment unless explicitly allowed
 * (bughunt data-tenant). CI/dev/test are unaffected (NODE_ENV unset or
 * development/test there).
 */
export function assertSeedAllowed(
  env: { NODE_ENV?: string; ALLOW_SEED?: string } = process.env,
): void {
  if (env.NODE_ENV === "production" && env.ALLOW_SEED !== "1") {
    throw new Error(
      "Refusing to seed in production. Set ALLOW_SEED=1 to override.",
    );
  }
}

const SEED_USERS = [
  {
    workosUserId: "seed-owner-1",
    email: "owner@contoh.co.id",
    name: "Budi Owner",
    role: "owner" as const,
  },
  {
    workosUserId: "seed-admin-1",
    email: "admin@contoh.co.id",
    name: "Sari Admin",
    role: "admin" as const,
  },
  {
    workosUserId: "seed-member-1",
    email: "member@contoh.co.id",
    name: "Andi Member",
    role: "member" as const,
  },
];

const SEED_BRANCHES = [
  { name: "Kantor Pusat", address: "Jl. Jend. Sudirman No. 1, Jakarta" },
  { name: "Cabang Surabaya", address: "Jl. Basuki Rahmat No. 10, Surabaya" },
];

/**
 * Idempotent + concurrency-safe seed. Everything runs inside one transaction
 * serialized by a session-level advisory lock keyed on the org slug, so two
 * overlapping invocations cannot race the select-then-insert checks.
 * Conflict-safe upserts (onConflictDoNothing) make re-runs and
 * stragglers harmless even after the lock is released.
 */
async function seed() {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('openbizcrm-seed'))`,
    );

    // Org
    let [org] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.slug, ORG_SLUG))
      .limit(1);
    if (!org) {
      [org] = await tx
        .insert(organizations)
        .values({ name: ORG_NAME, slug: ORG_SLUG, workosOrgId: ORG_WORKOS_ID })
        .onConflictDoNothing()
        .returning();
      if (!org) {
        // Concurrent seed inserted it between lock release risk — re-read.
        [org] = await tx
          .select()
          .from(organizations)
          .where(eq(organizations.slug, ORG_SLUG))
          .limit(1);
      }
      console.log(`+ org ${ORG_SLUG}`);
    }
    // Orgs created before migration 0009 (or by createOrg) have workos_org_id
    // NULL, which makes resolveSessionIds reject the seeded AuthKit session.
    // Backfill the mapping when missing.
    if (!org.workosOrgId) {
      // cubic P2 seed:97 — workos_org_id unik. UPDATE buta bisa abort seluruh
      // seed kalau org lain sudah memegang ORG_WORKOS_ID. Cek pemilik id
      // dulu: bebas → backfill normal; dibawa org lain → pakai sufiks
      // deterministik, jangan mencuri / jangan gagal.
      const [owner] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.workosOrgId, ORG_WORKOS_ID))
        .limit(1);
      const target = owner ? `${ORG_WORKOS_ID}-alt` : ORG_WORKOS_ID;
      await tx
        .update(organizations)
        .set({ workosOrgId: target })
        .where(
          and(
            eq(organizations.slug, ORG_SLUG),
            isNull(organizations.workosOrgId),
          ),
        );
      org.workosOrgId = target;
      console.log(
        owner
          ? `~ workos_org_id bentrok (org lain); ${ORG_SLUG} pakai ${target}`
          : `~ backfilled workos_org_id on org ${ORG_SLUG}`,
      );
    }

    // Branches — org-scoped unique constraint makes this conflict-safe.
    for (const b of SEED_BRANCHES) {
      await tx
        .insert(branches)
        .values({ orgId: org.id, ...b })
        .onConflictDoNothing({
          target: [branches.orgId, branches.name],
        });
      console.log(`+ branch ${b.name}`);
    }

    // Users + memberships — workosUserId/email unique make this safe.
    for (const u of SEED_USERS) {
      let [user] = await tx
        .select()
        .from(users)
        .where(eq(users.workosUserId, u.workosUserId))
        .limit(1);
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({
            workosUserId: u.workosUserId,
            email: u.email,
            name: u.name,
            currentOrgId: org.id,
          })
          .onConflictDoNothing()
          .returning();
        if (!user) {
          [user] = await tx
            .select()
            .from(users)
            .where(eq(users.workosUserId, u.workosUserId))
            .limit(1);
        }
        console.log(`+ user ${u.workosUserId}`);
      }
      // Rows created elsewhere before the seed ran (createUser accepts a
      // null currentOrgId) may have it NULL — backfill so session-id
      // resolution works. The column itself has always existed.
      if (!user.currentOrgId) {
        await tx
          .update(users)
          .set({ currentOrgId: org.id })
          .where(eq(users.id, user.id));
        user.currentOrgId = org.id;
      }
      await tx
        .insert(orgMemberships)
        .values({ orgId: org.id, userId: user.id, role: u.role })
        .onConflictDoNothing({
          target: [orgMemberships.orgId, orgMemberships.userId],
        });
      console.log(`+ membership ${u.workosUserId} (${u.role})`);
    }

    // Audit sample
    const logs = await tx
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.orgId, org.id));
    if (logs.length === 0) {
      const [owner] = await tx
        .select()
        .from(users)
        .where(eq(users.workosUserId, "seed-owner-1"))
        .limit(1);
      await tx.insert(auditLogs).values({
        orgId: org.id,
        userId: owner.id,
        action: "seed.sample",
        entity: "organization",
        entityId: org.id,
        metadata: { source: "seed" },
      });
      console.log("+ audit sample");
    }

    // ----- CRM -----
    const [owner] = await tx
      .select()
      .from(users)
      .where(eq(users.workosUserId, "seed-owner-1"))
      .limit(1);
    const member = await tx
      .select()
      .from(users)
      .where(eq(users.workosUserId, "seed-member-1"))
      .limit(1);

    // 2 companies — unik per (org, name), jadi onConflictDoNothing aman.
    const SEED_COMPANIES = [
      { name: "PT Maju Bersama", industry: "Retail" },
      { name: "CV Tekno Nusantara", industry: "Teknologi" },
    ];
    const companyIds: Record<string, string> = {};
    for (const c of SEED_COMPANIES) {
      const [row] = await tx
        .insert(crmCompanies)
        .values({
          orgId: org.id,
          name: c.name,
          industry: c.industry,
          ownerUserId: owner.id,
        })
        .onConflictDoNothing({
          target: [crmCompanies.orgId, crmCompanies.name],
        })
        .returning();
      if (row) {
        companyIds[c.name] = row.id;
        console.log(`+ crm company ${c.name}`);
      }
    }
    // Bila seed sudah pernah jalan, ambil id yang ada.
    const existingCompanies = await tx
      .select()
      .from(crmCompanies)
      .where(eq(crmCompanies.orgId, org.id));
    for (const c of existingCompanies) {
      companyIds[c.name] ??= c.id;
    }

    // 3 contacts
    const SEED_CONTACTS = [
      {
        company: "PT Maju Bersama",
        name: "Rina Sales",
        email: "rina@majubersama.co.id",
        phone: "081234567890",
      },
      {
        company: "PT Maju Bersama",
        name: "Dedi Purchasing",
        email: "dedi@majubersama.co.id",
        phone: "081298765432",
      },
      {
        company: "CV Tekno Nusantara",
        name: "Wawan IT",
        email: "wawan@tekno.id",
        phone: "081311223344",
      },
    ];
    const existingContacts = await tx
      .select()
      .from(crmContacts)
      .where(eq(crmContacts.orgId, org.id));
    const contactByName = new Map(existingContacts.map((c) => [c.name, c]));
    for (const c of SEED_CONTACTS) {
      if (contactByName.has(c.name)) continue;
      const [row] = await tx
        .insert(crmContacts)
        .values({
          orgId: org.id,
          companyId: companyIds[c.company],
          name: c.name,
          email: c.email,
          phone: c.phone,
        })
        .returning();
      contactByName.set(c.name, row);
      console.log(`+ crm contact ${c.name}`);
    }

    // Pipeline + 6 stages per company PT Maju Bersama (idempotent).
    const mainCompanyId = companyIds["PT Maju Bersama"];
    let [pipeline] = await tx
      .select()
      .from(crmPipelines)
      .where(
        and(
          eq(crmPipelines.orgId, org.id),
          eq(crmPipelines.companyId, mainCompanyId),
          eq(crmPipelines.name, "Pipeline"),
        ),
      )
      .limit(1);
    if (!pipeline) {
      [pipeline] = await tx
        .insert(crmPipelines)
        .values({ orgId: org.id, companyId: mainCompanyId, name: "Pipeline" })
        .onConflictDoNothing()
        .returning();
      if (!pipeline) {
        [pipeline] = await tx
          .select()
          .from(crmPipelines)
          .where(
            and(
              eq(crmPipelines.orgId, org.id),
              eq(crmPipelines.companyId, mainCompanyId),
              eq(crmPipelines.name, "Pipeline"),
            ),
          )
          .limit(1);
      }
      console.log("+ crm pipeline Pipeline");
    }
    const stageRows = await tx
      .select()
      .from(crmStages)
      .where(eq(crmStages.pipelineId, pipeline.id))
      .orderBy(crmStages.position);
    // Guard per nama stage, bukan sekadar "ada beberapa stage": pipeline
    // parsial (mis. tanpa Close Won) membuat stage.name crash saat seeding
    // deal.
    const stageNames = new Set(stageRows.map((s) => s.name));
    const missingStages = DEFAULT_STAGE_NAMES.filter(
      (name) => !stageNames.has(name),
    );
    if (missingStages.length > 0) {
      // Masukkan di urutan kosong SETELAH posisi tertinggi yang sudah ada —
      // posisi kanonik bisa diduduki stage lain pada pipeline parsial, dan
      // onConflictDoNothing akan diam-diam membuang stage itu sehingga
      // stageByName.get(name) crash saat seeding deal. Insert konflik-aman
      // (cubic P2 seed:326): getOrCreateDefaultPipeline konkuren bisa
      // mengisi pipeline kosong setelah read ini; DO NOTHING + re-read
      // supaya seed tidak rollback, bukan insert telanjang yang bisa gagal
      // unik (pipeline, position).
      const nextPos = (stageRows.at(-1)?.position ?? -1) + 1;
      await tx
        .insert(crmStages)
        .values(
          missingStages.map((name, i) => ({
            orgId: org.id,
            pipelineId: pipeline.id,
            name,
            position: nextPos + i,
          })),
        )
        .onConflictDoNothing();
      console.log(`+ crm stages (${missingStages.length} kurang)`);
    }
    const stages = await tx
      .select()
      .from(crmStages)
      .where(eq(crmStages.pipelineId, pipeline.id))
      .orderBy(crmStages.position);
    const stageByName = new Map(stages.map((s) => [s.name, s]));

    // 5 deals spread across stages (idempotent: judul unik dicek dulu).
    const existingDeals = await tx
      .select()
      .from(crmDeals)
      .where(eq(crmDeals.orgId, org.id));
    const dealByTitle = new Map(existingDeals.map((d) => [d.title, d]));
    const SEED_DEALS = [
      {
        title: "Implementasi POS 10 Outlet",
        stage: "Leads Baru",
        value: 120_000_000,
      },
      {
        title: "Langganan Cloud Quarterly",
        stage: "Sudah Dihubungi",
        value: 35_000_000,
      },
      {
        title: "Integrasi ERP Cabang",
        stage: "Dijadwalkan Meeting",
        value: 85_000_000,
      },
      {
        title: "Paket Support Tahunan",
        stage: "Quotation Dikirim",
        value: 45_000_000,
      },
      {
        title: "Upgrade Hardware Server",
        stage: "Close Won",
        value: 60_000_000,
      },
    ];
    const dealIds: string[] = [];
    for (const d of SEED_DEALS) {
      if (dealByTitle.has(d.title)) {
        dealIds.push(dealByTitle.get(d.title)!.id);
        continue;
      }
      const stage = stageByName.get(d.stage)!;
      const closed = stage.name.startsWith("Close");
      const [row] = await tx
        .insert(crmDeals)
        .values({
          orgId: org.id,
          pipelineId: pipeline.id,
          stageId: stage.id,
          companyId: mainCompanyId,
          contactId: contactByName.get("Rina Sales")!.id,
          title: d.title,
          value: d.value,
          status: stage.name === "Close Won" ? "won" : "open",
          closedAt: closed ? new Date() : null,
        })
        .returning();
      dealIds.push(row.id);
      console.log(`+ crm deal ${d.title} (${d.stage})`);
    }

    // 4 activities pada deal pertama (idempotent: konten dicek dulu).
    const existingActs = await tx
      .select()
      .from(crmActivities)
      .where(eq(crmActivities.orgId, org.id));
    const actContents = new Set(existingActs.map((a) => a.content));
    const SEED_ACTIVITIES = [
      {
        type: "call" as const,
        content: "Telepon perdana, tanya kebutuhan POS",
      },
      {
        type: "meeting" as const,
        content: "Meeting demo produk di kantor klien",
      },
      { type: "task" as const, content: "Kirim proposal harga lengkap" },
      {
        type: "note" as const,
        content: "Klien minta skema pembayaran 3 termin",
      },
    ];
    for (const a of SEED_ACTIVITIES) {
      if (actContents.has(a.content)) continue;
      await tx.insert(crmActivities).values({
        orgId: org.id,
        dealId: dealIds[0],
        userId: member[0]?.id ?? owner.id,
        type: a.type,
        content: a.content,
      });
      console.log(`+ crm activity [${a.type}]`);
    }

    // ----- Projects / Tasks / Timesheet -----
    const existingProjects = await tx
      .select()
      .from(projects)
      .where(eq(projects.orgId, org.id));
    const projectByCode = new Map(existingProjects.map((p) => [p.code, p]));

    // 2 projects — 1 client-linked.
    const SEED_PROJECTS = [
      {
        code: "PRJ-001",
        name: "Website Company Profile",
        client: "PT Maju Bersama",
        status: "active" as const,
      },
      {
        code: "PRJ-002",
        name: "Portal Internal HRM",
        client: null,
        status: "planning" as const,
      },
    ];
    for (const p of SEED_PROJECTS) {
      if (!projectByCode.has(p.code)) {
        const [row] = await tx
          .insert(projects)
          .values({
            orgId: org.id,
            code: p.code,
            name: p.name,
            clientCompanyId: p.client ? companyIds[p.client] : null,
            status: p.status,
          })
          .returning();
        projectByCode.set(p.code, row);
        console.log(`+ project ${p.code} ${p.name}`);
      }
    }

    // 10 tasks across statuses (idempotent: judul dicek per proyek — judul
    // sama di proyek lain tidak boleh men-skip seed PRJ-001; unique
    // (org,project,title,dueDate) hanya berlaku saat dueDate terisi).
    const existingTasks = await tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.orgId, org.id),
          eq(tasks.projectId, projectByCode.get("PRJ-001")!.id),
        ),
      );
    const mainProject = projectByCode.get("PRJ-001")!;
    const taskTitles = new Set(existingTasks.map((t) => t.title));
    const SEED_TASKS: {
      title: string;
      status: "todo" | "in_progress" | "review" | "done" | "blocked";
      priority: "low" | "medium" | "high" | "urgent";
      assignee: "owner" | "member";
    }[] = [
      {
        title: "Setup repo & CI",
        status: "done",
        priority: "high",
        assignee: "owner",
      },
      {
        title: "Desain landing page",
        status: "done",
        priority: "medium",
        assignee: "member",
      },
      {
        title: "Halaman Beranda",
        status: "in_progress",
        priority: "high",
        assignee: "member",
      },
      {
        title: "Halaman Tentang Kami",
        status: "in_progress",
        priority: "medium",
        assignee: "member",
      },
      {
        title: "Halaman Layanan",
        status: "todo",
        priority: "medium",
        assignee: "member",
      },
      {
        title: "Form Kontak",
        status: "todo",
        priority: "low",
        assignee: "owner",
      },
      {
        title: "Review SEO & meta tags",
        status: "review",
        priority: "medium",
        assignee: "owner",
      },
      {
        title: "Deploy ke production",
        status: "todo",
        priority: "urgent",
        assignee: "owner",
      },
      {
        title: "Integrasi analytics",
        status: "blocked",
        priority: "low",
        assignee: "member",
      },
      {
        title: "Riset kompetitor",
        status: "todo",
        priority: "low",
        assignee: "member",
      },
    ];
    const createdTasks: (typeof tasks.$inferSelect)[] = [...existingTasks];
    let position = 0;
    for (const t of SEED_TASKS) {
      if (taskTitles.has(t.title)) continue;
      const [row] = await tx
        .insert(tasks)
        .values({
          orgId: org.id,
          projectId: mainProject.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          assigneeId: (t.assignee === "owner" ? owner : member[0])?.id ?? null,
          position: position++,
        })
        .returning();
      createdTasks.push(row);
      console.log(`+ task ${t.title} (${t.status})`);
    }

    // 1 daily standup template.
    const [tpl] = await tx
      .select()
      .from(taskTemplates)
      .where(
        and(
          eq(taskTemplates.orgId, org.id),
          eq(taskTemplates.name, "Daily Standup"),
        ),
      )
      .limit(1);
    if (!tpl) {
      await tx.insert(taskTemplates).values({
        orgId: org.id,
        name: "Daily Standup",
        description: "Ritual harian: progress, blocker, rencana hari ini.",
        priority: "medium",
      });
      console.log("+ task template Daily Standup");
    }

    // A few timesheet rows (closed timers).
    const existingTs = await tx
      .select()
      .from(timesheets)
      .where(eq(timesheets.orgId, org.id));
    if (existingTs.length === 0 && createdTasks.length >= 2) {
      const memberUser = member[0] ?? owner;
      const now = Date.now();
      const rows = [
        { task: createdTasks[0], minutes: 95, offsetMin: 600 },
        { task: createdTasks[1], minutes: 40, offsetMin: 300 },
        { task: createdTasks[2], minutes: 65, offsetMin: 120 },
      ];
      for (const r of rows) {
        const startedAt = new Date(now - r.offsetMin * 60_000);
        const endedAt = new Date(startedAt.getTime() + r.minutes * 60_000);
        await tx.insert(timesheets).values({
          orgId: org.id,
          taskId: r.task.id,
          userId: memberUser.id,
          startedAt,
          endedAt,
          minutes: r.minutes,
          notes: "Seed timesheet",
        });
      }
      console.log("+ timesheet rows (3)");
    }

    // ----- LMS + Pengumuman + Review 360 (idempoten) -----

    // 1 kursus + 1 materi + 1 completion.
    let [seedCourse] = await tx
      .select()
      .from(courses)
      .where(
        and(
          eq(courses.orgId, org.id),
          eq(courses.title, "Onboarding Karyawan"),
        ),
      )
      .limit(1);
    if (!seedCourse) {
      [seedCourse] = await tx
        .insert(courses)
        .values({
          orgId: org.id,
          title: "Onboarding Karyawan",
          description: "Kursus wajib karyawan baru.",
          createdBy: owner.id,
        })
        .onConflictDoNothing({ target: [courses.orgId, courses.title] })
        .returning();
      console.log("+ course Onboarding Karyawan");
    }
    if (seedCourse) {
      const [mat] = await tx
        .select()
        .from(courseMaterials)
        .where(eq(courseMaterials.courseId, seedCourse.id))
        .limit(1);
      if (!mat) {
        await tx.insert(courseMaterials).values({
          orgId: org.id,
          courseId: seedCourse.id,
          title: "Modul 1: Budaya Kerja",
          content: "Selamat datang! Modul ini membahas nilai dan ritme kerja.",
        });
        console.log("+ course material Modul 1");
      }
      const done = await tx
        .select()
        .from(courseCompletions)
        .where(
          and(
            eq(courseCompletions.courseId, seedCourse.id),
            eq(courseCompletions.userId, member[0]?.id ?? owner.id),
          ),
        )
        .limit(1);
      if (done.length === 0) {
        await tx.insert(courseCompletions).values({
          orgId: org.id,
          courseId: seedCourse.id,
          userId: member[0]?.id ?? owner.id,
        });
        console.log("+ course completion (member)");
      }
    }

    // 1 pengumuman.
    const [ann] = await tx
      .select()
      .from(announcements)
      .where(eq(announcements.orgId, org.id))
      .limit(1);
    if (!ann) {
      await tx.insert(announcements).values({
        orgId: org.id,
        title: "Selamat Datang di OpenBizCRM",
        body: "Portal internal: HRM, CRM, keuangan, dan penilaian 360 dalam satu tempat.",
        createdBy: owner.id,
      });
      console.log("+ announcement");
    }

    // Review 360: 1 form aktif + periode + assignment + respons.
    let [rform] = await tx
      .select()
      .from(reviewForms)
      .where(
        and(
          eq(reviewForms.orgId, org.id),
          eq(reviewForms.title, "Review Kinerja 360"),
        ),
      )
      .limit(1);
    if (!rform) {
      [rform] = await tx
        .insert(reviewForms)
        .values({
          orgId: org.id,
          title: "Review Kinerja 360",
          description:
            "Penilaian dua arah: atasan, rekan, bawahan, diri sendiri.",
          status: "active",
          slug: `review-kinerja-360-${org.id.slice(0, 8)}`,
          fields: [
            {
              key: "skor",
              label: "Skor keseluruhan (1-5)",
              type: "number",
              required: true,
              min: 1,
              max: 5,
            },
            {
              key: "kekuatan",
              label: "Kekuatan",
              type: "textarea",
              required: true,
            },
            {
              key: "perbaikan",
              label: "Area perbaikan",
              type: "textarea",
              required: false,
            },
          ],
          createdBy: owner.id,
        })
        .onConflictDoNothing({ target: reviewForms.slug })
        .returning();
      console.log("+ review form Review Kinerja 360 (aktif)");
    }
    if (rform) {
      let [period] = await tx
        .select()
        .from(reviewPeriods)
        .where(
          and(
            eq(reviewPeriods.orgId, org.id),
            eq(reviewPeriods.formId, rform.id),
          ),
        )
        .limit(1);
      if (!period) {
        [period] = await tx
          .insert(reviewPeriods)
          .values({
            orgId: org.id,
            formId: rform.id,
            title: "Review Kinerja Q4",
            status: "open",
            createdBy: owner.id,
          })
          .returning();
        console.log("+ review period Q4 (open)");
      }
      // 2 assignment: member self-review + owner menilai member.
      const pairRows = [
        {
          revieweeUserId: member[0]?.id ?? owner.id,
          reviewerUserId: member[0]?.id ?? owner.id,
          relation: "self" as const,
        },
        {
          revieweeUserId: member[0]?.id ?? owner.id,
          reviewerUserId: owner.id,
          relation: "supervisor" as const,
        },
      ];
      await tx
        .insert(reviewAssignments)
        .values(
          pairRows.map((p) => ({
            orgId: org.id,
            periodId: period!.id,
            reviewerUserId: p.reviewerUserId,
            revieweeUserId: p.revieweeUserId,
            relation: p.relation,
          })),
        )
        .onConflictDoNothing({
          target: [
            reviewAssignments.periodId,
            reviewAssignments.reviewerUserId,
            reviewAssignments.revieweeUserId,
          ],
        });
      console.log("+ review assignments (2)");

      // 1 respons terisi (self review member), kalau belum ada.
      const seededSelf = member[0]?.id ?? owner.id;
      const selfAssignment = await tx
        .select()
        .from(reviewAssignments)
        .where(
          and(
            eq(reviewAssignments.periodId, period!.id),
            eq(reviewAssignments.reviewerUserId, seededSelf),
            // Filter reviewee + relation (cubic seed.ts:844): tanpa itu
            // assignment milik reviewee lain bisa menerima jawaban self.
            eq(reviewAssignments.revieweeUserId, seededSelf),
            eq(reviewAssignments.relation, "self"),
          ),
        )
        .limit(1);
      if (selfAssignment[0] && selfAssignment[0].status === "pending") {
        const existing = await tx
          .select()
          .from(reviewResponses)
          .where(eq(reviewResponses.assignmentId, selfAssignment[0].id))
          .limit(1);
        if (existing.length === 0) {
          await tx.insert(reviewResponses).values({
            orgId: org.id,
            assignmentId: selfAssignment[0].id,
            answers: {
              skor: 4,
              kekuatan: "Konsisten menyelesaikan task tepat waktu.",
              perbaikan: "Komunikasi lintas tim bisa lebih proaktif.",
            },
            submittedByUserId: member[0]?.id ?? owner.id,
          });
          await tx
            .update(reviewAssignments)
            .set({ status: "submitted" })
            .where(eq(reviewAssignments.id, selfAssignment[0].id));
          console.log("+ review response (self, submitted)");
        }
      }
    }
  });

  console.log("Seed selesai (idempotent).");
}

// Only auto-run when invoked directly (`bun src/db/seed.ts`); importing
// this module (e.g. unit tests for assertSeedAllowed) must not seed.
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  /(^|[\\/])seed\.(ts|js|cjs|mjs)$/.test(process.argv[1]);
if (invokedDirectly) {
  assertSeedAllowed();
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
