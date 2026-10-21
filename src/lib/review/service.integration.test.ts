import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { organizations, orgMemberships, users } from "@/db/schema";
import { NotFoundError, OrgScopeError } from "@/lib/org-scope";

// DB-touching modules load ONLY when RUN_DB_TESTS=1 (cubic pattern: static
// top-level @/db imports initialize the DB stack even when skipped).
type ReviewService = typeof import("@/lib/review/service");
type OrgRepo = typeof import("@/lib/repos/org-repo");
type UserRepo = typeof import("@/lib/repos/user-repo");

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("review 360 integration", () => {
  let svc!: ReviewService;
  let createOrg!: OrgRepo["createOrg"];
  let createUser!: UserRepo["createUser"];
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];

  const suffix = Date.now().toString(36);
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  let orgA!: { id: string };
  let owner!: { id: string };
  let peer1!: { id: string };
  let peer2!: { id: string };
  let formId!: string;
  let periodId!: string;
  let assignmentSelf!: string;
  let assignmentPeer!: string;
  let slug!: string;

  const FIELDS = [
    {
      key: "skor",
      label: "Skor",
      type: "number" as const,
      required: true,
      min: 1,
      max: 5,
    },
    {
      key: "komentar",
      label: "Komentar",
      type: "textarea" as const,
      required: true,
    },
  ];

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    svc = await import("@/lib/review/service");
    ({ createOrg } = await import("@/lib/repos/org-repo"));
    ({ createUser } = await import("@/lib/repos/user-repo"));

    owner = await createUser({
      email: `rev-owner-${suffix}@test.local`,
      name: "Owner Review",
    });
    createdUserIds.push(owner.id);
    orgA = await createOrg(
      { name: "Review Test Org", slug: `rev-org-${suffix}` },
      owner.id,
    );
    createdOrgIds.push(orgA.id);
    peer1 = await createUser({
      email: `rev-p1-${suffix}@test.local`,
      name: "Peer 1",
    });
    createdUserIds.push(peer1.id);
    peer2 = await createUser({
      email: `rev-p2-${suffix}@test.local`,
      name: "Peer 2",
    });
    createdUserIds.push(peer2.id);
    await db.insert(orgMemberships).values([
      { orgId: orgA.id, userId: peer1.id, role: "member" },
      { orgId: orgA.id, userId: peer2.id, role: "member" },
    ]);
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    // Track-based cleanup: hapus org (cascade) dulu, lalu user TETAP
    // dihapus eksplisit (cubic service.integration.test.ts:94) — org
    // cascade tidak menghapus users, cabang kedua tak boleh bersyarat.
    if (createdOrgIds.length > 0) {
      await db
        .delete(organizations)
        .where(inArray(organizations.id, createdOrgIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  });

  itDb("create + publish form -> slug unik", async () => {
    const form = await svc.createForm(owner.id, orgA.id, {
      title: `Form Review ${suffix}`,
      fields: FIELDS,
    });
    formId = form.id;
    expect(form.status).toBe("draft");
    expect(form.slug).toBeNull();

    const published = await svc.publishForm(owner.id, orgA.id, form.id);
    expect(published.status).toBe("active");
    expect(published.slug).toContain("form-review");
    slug = published.slug!;

    const bySlug = await svc.getFormBySlug(slug);
    expect(bySlug?.id).toBe(formId);
  });

  itDb("period menolak judul kosong dan tanggal tak valid", async () => {
    await expect(
      svc.createPeriod(owner.id, orgA.id, { formId, title: "   " }),
    ).rejects.toThrow("Judul periode");
    await expect(
      svc.createPeriod(owner.id, orgA.id, {
        formId,
        title: "Periode X",
        startDate: "2026-12-31",
        endDate: "2026-01-01",
      }),
    ).rejects.toThrow("Tanggal selesai");
    await expect(
      svc.createPeriod(owner.id, orgA.id, {
        formId,
        title: "Periode X",
        startDate: "2026-13-01",
      }),
    ).rejects.toThrow("Tanggal mulai");
  });

  itDb("period dibuat dari form aktif; form draft ditolak", async () => {
    const draft = await svc.createForm(owner.id, orgA.id, {
      title: `Draft ${suffix}`,
      fields: FIELDS,
    });
    await expect(
      svc.createPeriod(owner.id, orgA.id, {
        formId: draft.id,
        title: "Gagal",
      }),
    ).rejects.toThrow("form aktif");
    const period = await svc.createPeriod(owner.id, orgA.id, {
      formId,
      title: `Periode Q4 ${suffix}`,
    });
    periodId = period.id;
    expect(period.status).toBe("open");
  });

  itDb("auto-assign: self + peer, duplikat onConflictDoNothing", async () => {
    const rows = await svc.assignReviewers(owner.id, orgA.id, periodId, [
      { revieweeUserId: peer1.id, reviewerUserId: peer1.id, relation: "self" },
      { revieweeUserId: peer1.id, reviewerUserId: peer2.id, relation: "peer" },
    ]);
    expect(rows).toHaveLength(2);
    // Re-run: duplikat ditelan, rows kosong.
    const again = await svc.assignReviewers(owner.id, orgA.id, periodId, [
      { revieweeUserId: peer1.id, reviewerUserId: peer1.id, relation: "self" },
    ]);
    expect(again).toHaveLength(0);

    const mine = await svc.listMyAssignments(peer1.id, orgA.id, periodId);
    expect(mine).toHaveLength(1);
    assignmentSelf = mine[0].id;
    expect(mine[0].revieweeName).toBe("Peer 1");

    const peerAssignments = await svc.listMyAssignments(
      peer2.id,
      orgA.id,
      periodId,
    );
    assignmentPeer = peerAssignments[0].id;
  });

  itDb("jawaban invalid ditolak sebelum insert", async () => {
    await expect(
      svc.submitResponse(peer1.id, orgA.id, assignmentSelf, {
        komentar: "tanpa skor",
      }),
    ).rejects.toThrow();
    const mine = await svc.listMyAssignments(peer1.id, orgA.id, periodId);
    expect(mine[0].status).toBe("pending");
  });

  itDb("submit berhasil lalu double-submit ditolak", async () => {
    const resp = await svc.submitResponse(peer1.id, orgA.id, assignmentSelf, {
      skor: 4,
      komentar: "Self review",
    });
    expect(resp.answers).toEqual({ skor: 4, komentar: "Self review" });

    await expect(
      svc.submitResponse(peer1.id, orgA.id, assignmentSelf, {
        skor: 5,
        komentar: "x",
      }),
    ).rejects.toThrow("sudah mengirim");

    // Non-reviewer juga ditolak sebagai NotFound.
    await expect(
      svc.submitResponse(peer2.id, orgA.id, assignmentSelf, {
        skor: 3,
        komentar: "y",
      }),
    ).rejects.toThrow(NotFoundError);

    await svc.submitResponse(peer2.id, orgA.id, assignmentPeer, {
      skor: 2,
      komentar: "Peer review",
    });
  });

  itDb("org isolation: user org lain tak bisa submit / akses", async () => {
    const outsider = await createUser({
      email: `rev-out-${suffix}@test.local`,
      name: "Outsider",
    });
    createdUserIds.push(outsider.id);
    const orgB = await createOrg(
      { name: "Other Org", slug: `rev-org-b-${suffix}` },
      outsider.id,
    );
    createdOrgIds.push(orgB.id);

    await expect(
      svc.submitResponse(outsider.id, orgB.id, assignmentSelf, {
        skor: 5,
        komentar: "crossover",
      }),
    ).rejects.toThrow(NotFoundError);
    // Bahkan owner org A yang berbeda keanggotaan: requireOrgRole menolak.
    const stranger = await createUser({
      email: `rev-stranger-${suffix}@test.local`,
      name: "Stranger",
    });
    createdUserIds.push(stranger.id);
    await expect(
      svc.submitResponse(stranger.id, orgA.id, assignmentPeer, {
        skor: 5,
        komentar: "z",
      }),
    ).rejects.toThrow(OrgScopeError);
  });

  itDb("submit publik via slug + assignment token", async () => {
    // Assignment kedua untuk peer2 (peer lain) belum dikirim; pakai token.
    const extra = await svc.assignReviewers(owner.id, orgA.id, periodId, [
      { revieweeUserId: peer2.id, reviewerUserId: peer1.id, relation: "peer" },
    ]);
    expect(extra).toHaveLength(1);
    const token = extra[0].id;

    // Jawaban invalid ditolak.
    await expect(
      svc.submitPublicResponse(slug, token, { skor: 9, komentar: "x" }),
    ).rejects.toThrow();

    const resp = await svc.submitPublicResponse(slug, token, {
      skor: 5,
      komentar: "Publik anonim",
    });
    expect(resp.submittedByUserId).toBeNull();
    // Double submit via tautan sama ditolak.
    await expect(
      svc.submitPublicResponse(slug, token, { skor: 4, komentar: "ulang" }),
    ).rejects.toThrow("sudah pernah dikirim");
    // Slug asing ditolak.
    await expect(
      svc.submitPublicResponse("slug-tak-ada", token, {
        skor: 4,
        komentar: "x",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  itDb(
    "publik: tautan form A tidak bisa isi assignment periode form B",
    async () => {
      // Form + periode kedua (form beda) di org sama.
      const formB = await svc.createForm(owner.id, orgA.id, {
        title: `Form B ${suffix}`,
        fields: FIELDS,
      });
      const publishedB = await svc.publishForm(owner.id, orgA.id, formB.id);
      const periodB = await svc.createPeriod(owner.id, orgA.id, {
        formId: publishedB.id,
        title: `Periode B ${suffix}`,
      });
      const assignmentB = await svc.assignReviewers(
        owner.id,
        orgA.id,
        periodB.id,
        [
          {
            revieweeUserId: peer1.id,
            reviewerUserId: peer1.id,
            relation: "self",
          },
        ],
      );
      expect(assignmentB).toHaveLength(1);

      // Slug form A (periodId pertama) + assignment milik periode form B.
      await expect(
        svc.submitPublicResponse(slug, assignmentB[0].id, {
          skor: 5,
          komentar: "salah form",
        }),
      ).rejects.toThrow(NotFoundError);
      // Assignment B tetap pending.
      const mine = await svc.listMyAssignments(peer1.id, orgA.id, periodB.id);
      expect(mine[0].status).toBe("pending");
    },
  );

  itDb("assignReviewers menolak user lintas organisasi", async () => {
    const outsider = await createUser({
      email: `rev-xorg-${suffix}@test.local`,
      name: "XOrg",
    });
    createdUserIds.push(outsider.id);
    await expect(
      svc.assignReviewers(owner.id, orgA.id, periodId, [
        {
          revieweeUserId: outsider.id,
          reviewerUserId: peer1.id,
          relation: "peer",
        },
      ]),
    ).rejects.toThrow("bukan anggota");
    // Juga reviewer yang bukan anggota.
    await expect(
      svc.assignReviewers(owner.id, orgA.id, periodId, [
        {
          revieweeUserId: peer1.id,
          reviewerUserId: outsider.id,
          relation: "peer",
        },
      ]),
    ).rejects.toThrow("bukan anggota");
  });

  itDb("closePeriod -> agregat rata-rata per reviewee", async () => {
    // Assignment pending ekstra (owner menilai peer1) untuk uji gate periode.
    const extra = await svc.assignReviewers(owner.id, orgA.id, periodId, [
      {
        revieweeUserId: peer1.id,
        reviewerUserId: owner.id,
        relation: "supervisor",
      },
    ]);
    expect(extra).toHaveLength(1);

    const closed = await svc.closePeriod(owner.id, orgA.id, periodId);
    expect(closed.status).toBe("closed");
    const results = closed.results as Record<
      string,
      { count: number; average: number }
    >;
    // peer1: self 4 + peer 2 => avg 3, count 2.
    expect(results[peer1.id]).toEqual({ count: 2, average: 3 });
    // Idempoten.
    const again = await svc.closePeriod(owner.id, orgA.id, periodId);
    expect(again.id).toBe(periodId);
  });

  itDb("submit setelah periode closed ditolak", async () => {
    // Owner punya assignment pending (supervisor) yang belum dikirim.
    const mine = await svc.listMyAssignments(owner.id, orgA.id, periodId);
    expect(mine[0].status).toBe("pending");
    await expect(
      svc.submitResponse(owner.id, orgA.id, mine[0].id, {
        skor: 5,
        komentar: "late",
      }),
    ).rejects.toThrow("ditutup");
  });

  itDb("announcement + kursus LMS dasar", async () => {
    const ann = await svc.createAnnouncement(owner.id, orgA.id, {
      title: `Pengumuman ${suffix}`,
      body: "Rapat jam 10.",
    });
    expect(ann.orgId).toBe(orgA.id);
    // Member tak boleh buat pengumuman.
    await expect(
      svc.createAnnouncement(peer1.id, orgA.id, { title: "X", body: "Y" }),
    ).rejects.toThrow(OrgScopeError);

    const course = await svc.createCourse(owner.id, orgA.id, {
      title: `Kursus ${suffix}`,
    });
    await svc.addMaterial(owner.id, orgA.id, {
      courseId: course.id,
      title: "Modul 1",
      content: "Isi modul.",
    });
    const materials = await svc.listMaterials(orgA.id, course.id);
    expect(materials).toHaveLength(1);
    await svc.completeCourse(peer1.id, orgA.id, course.id);
    // Idempoten.
    await svc.completeCourse(peer1.id, orgA.id, course.id);
    const done = await svc.listCompletions(orgA.id, peer1.id);
    expect(done).toHaveLength(1);
  });
});
