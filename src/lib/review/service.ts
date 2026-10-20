import { and, desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  announcements,
  courseCompletions,
  courseMaterials,
  courses,
  reviewAssignments,
  reviewForms,
  reviewPeriods,
  reviewResponses,
  users,
  type ReviewFormField,
  type ReviewForm,
  type ReviewPeriod,
  type ReviewAssignment,
  type ReviewResponse,
} from "@/db/schema";
import { NotFoundError, requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";
import { validateAnswers } from "./validate";
import { aggregate360 } from "./aggregate";

/**
 * Layanan Review 360. Semua mutasi org-scoped, guard role, audit, dan
 * read-modify-write dalam satu transaksi (pola accounting/service.ts).
 */

const FIELD_TYPES = ["text", "textarea", "number", "select", "checkbox"];

/** Validasi bentuk definisi field form (murni, dipakai create/update). */
export function validateFieldDefs(fields: ReviewFormField[]): string | null {
  if (!Array.isArray(fields)) return "Field harus berupa daftar.";
  const seen = new Set<string>();
  for (const f of fields) {
    if (!f.key || !/^[a-z0-9_]+$/i.test(f.key))
      return `Key field tidak valid: ${String(f.key)}`;
    if (seen.has(f.key)) return `Key field duplikat: ${f.key}`;
    seen.add(f.key);
    if (!FIELD_TYPES.includes(f.type))
      return `Tipe field tidak dikenal: ${String(f.type)}`;
    if (f.type === "select" && (!f.options || f.options.length === 0))
      return `Field select "${f.key}" wajib punya opsi.`;
  }
  return null;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function requireOrgForm(orgId: string, id: string): Promise<ReviewForm> {
  const [row] = await db
    .select()
    .from(reviewForms)
    .where(and(eq(reviewForms.id, id), eq(reviewForms.orgId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError("Form tidak ditemukan.");
  return row;
}

export async function createForm(
  userId: string,
  orgId: string,
  input: {
    title: string;
    description?: string | null;
    fields: ReviewFormField[];
  },
): Promise<ReviewForm> {
  await requireOrgRole(userId, orgId, "member");
  const invalid = validateFieldDefs(input.fields);
  if (invalid) throw new Error(invalid);
  const [row] = await db
    .insert(reviewForms)
    .values({
      orgId,
      title: input.title,
      description: input.description ?? null,
      fields: input.fields,
      createdBy: userId,
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "review.form.create",
    entity: "review_form",
    entityId: row.id,
  });
  return row;
}

export async function updateForm(
  userId: string,
  orgId: string,
  id: string,
  input: Partial<{
    title: string;
    description: string | null;
    fields: ReviewFormField[];
  }>,
): Promise<ReviewForm> {
  await requireOrgRole(userId, orgId, "member");
  return db.transaction(async (tx) => {
    const [form] = await tx
      .select()
      .from(reviewForms)
      .where(and(eq(reviewForms.id, id), eq(reviewForms.orgId, orgId)))
      .limit(1)
      .for("update");
    if (!form) throw new NotFoundError("Form tidak ditemukan.");
    if (form.status !== "draft")
      throw new Error("Hanya form draft yang bisa diubah.");
    if (input.fields) {
      const invalid = validateFieldDefs(input.fields);
      if (invalid) throw new Error(invalid);
    }
    const [row] = await tx
      .update(reviewForms)
      .set(input)
      .where(eq(reviewForms.id, id))
      .returning();
    await recordAudit(
      {
        orgId,
        userId,
        action: "review.form.update",
        entity: "review_form",
        entityId: id,
        metadata: input as Record<string, unknown>,
      },
      tx,
    );
    return row;
  });
}

/**
 * draft -> active. Slug unik global (halaman publik memakai slug polos);
 * bentrok ditambah sufiks -2, -3, … di dalam transaksi.
 */
export async function publishForm(
  userId: string,
  orgId: string,
  id: string,
): Promise<ReviewForm> {
  await requireOrgRole(userId, orgId, "member");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`review:${orgId}`}))`,
    );
    const [form] = await tx
      .select()
      .from(reviewForms)
      .where(and(eq(reviewForms.id, id), eq(reviewForms.orgId, orgId)))
      .limit(1)
      .for("update");
    if (!form) throw new NotFoundError("Form tidak ditemukan.");
    if (form.status === "active") return form; // idempoten
    if (form.status === "closed")
      throw new Error("Form sudah ditutup, tidak bisa dipublish ulang.");

    const base = slugify(form.title) || "form";
    let slug = base;
    for (let n = 2; ; n += 1) {
      const [taken] = await tx
        .select({ id: reviewForms.id })
        .from(reviewForms)
        .where(eq(reviewForms.slug, slug))
        .limit(1);
      if (!taken) break;
      slug = `${base}-${n}`;
    }
    const [row] = await tx
      .update(reviewForms)
      .set({ status: "active", slug })
      .where(eq(reviewForms.id, id))
      .returning();
    await recordAudit(
      {
        orgId,
        userId,
        action: "review.form.publish",
        entity: "review_form",
        entityId: id,
        metadata: { slug },
      },
      tx,
    );
    return row;
  });
}

export async function closeForm(
  userId: string,
  orgId: string,
  id: string,
): Promise<ReviewForm> {
  await requireOrgRole(userId, orgId, "member");
  return db.transaction(async (tx) => {
    const [form] = await tx
      .select()
      .from(reviewForms)
      .where(and(eq(reviewForms.id, id), eq(reviewForms.orgId, orgId)))
      .limit(1)
      .for("update");
    if (!form) throw new NotFoundError("Form tidak ditemukan.");
    // Optimistic: status diperiksa ulang di dalam tx; idempoten kalau sudah
    // closed.
    if (form.status === "closed") return form;
    const [row] = await tx
      .update(reviewForms)
      .set({ status: "closed" })
      .where(and(eq(reviewForms.id, id), eq(reviewForms.status, form.status)))
      .returning();
    await recordAudit(
      {
        orgId,
        userId,
        action: "review.form.close",
        entity: "review_form",
        entityId: id,
      },
      tx,
    );
    return row ?? form;
  });
}

export async function listForms(orgId: string): Promise<ReviewForm[]> {
  return db
    .select()
    .from(reviewForms)
    .where(eq(reviewForms.orgId, orgId))
    .orderBy(desc(reviewForms.createdAt));
}

export async function getFormBySlug(slug: string): Promise<ReviewForm | null> {
  const [row] = await db
    .select()
    .from(reviewForms)
    .where(eq(reviewForms.slug, slug))
    .limit(1);
  return row ?? null;
}

// ---------------- Periods ----------------

async function requireOrgPeriod(
  orgId: string,
  id: string,
): Promise<ReviewPeriod> {
  const [row] = await db
    .select()
    .from(reviewPeriods)
    .where(and(eq(reviewPeriods.id, id), eq(reviewPeriods.orgId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError("Periode tidak ditemukan.");
  return row;
}

export async function createPeriod(
  userId: string,
  orgId: string,
  input: {
    formId: string;
    title: string;
    startDate?: string | null;
    endDate?: string | null;
  },
): Promise<ReviewPeriod> {
  await requireOrgRole(userId, orgId, "member");
  const form = await requireOrgForm(orgId, input.formId);
  if (form.status !== "active")
    throw new Error("Periode hanya bisa memakai form aktif.");
  const [row] = await db
    .insert(reviewPeriods)
    .values({
      orgId,
      formId: form.id,
      title: input.title,
      status: "open",
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      createdBy: userId,
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "review.period.create",
    entity: "review_period",
    entityId: row.id,
  });
  return row;
}

export async function listPeriods(orgId: string): Promise<ReviewPeriod[]> {
  return db
    .select()
    .from(reviewPeriods)
    .where(eq(reviewPeriods.orgId, orgId))
    .orderBy(desc(reviewPeriods.createdAt));
}

/** Auto-assign: 2 penilai per reviewee (self + supervisor peer sederhana). */
export interface AutoAssignInput {
  /** Pasangan [revieweeUserId, reviewerUserId, relation]. */
  pairs: {
    revieweeUserId: string;
    reviewerUserId: string;
    relation: "peer" | "subordinate" | "self" | "supervisor";
  }[];
}

export async function assignReviewers(
  userId: string,
  orgId: string,
  periodId: string,
  pairs: AutoAssignInput["pairs"],
): Promise<ReviewAssignment[]> {
  await requireOrgRole(userId, orgId, "member");
  const period = await requireOrgPeriod(orgId, periodId);
  if (period.status !== "open")
    throw new Error("Periode sudah ditutup, tidak bisa menambah assignment.");
  if (pairs.length === 0) throw new Error("Daftar penilai kosong.");

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`review:${orgId}`}))`,
    );
    const rows = await tx
      .insert(reviewAssignments)
      .values(
        pairs.map((p) => ({
          orgId,
          periodId,
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
      })
      .returning();
    await recordAudit(
      {
        orgId,
        userId,
        action: "review.assignment.create",
        entity: "review_period",
        entityId: periodId,
        metadata: { count: rows.length },
      },
      tx,
    );
    return rows;
  });
}

export async function listMyAssignments(
  userId: string,
  orgId: string,
  periodId?: string,
): Promise<(ReviewAssignment & { revieweeName: string | null })[]> {
  await requireOrgRole(userId, orgId, "member");
  const conds = [
    eq(reviewAssignments.orgId, orgId),
    eq(reviewAssignments.reviewerUserId, userId),
  ];
  if (periodId) conds.push(eq(reviewAssignments.periodId, periodId));
  const rows = await db
    .select({
      assignment: reviewAssignments,
      revieweeName: users.name,
    })
    .from(reviewAssignments)
    .leftJoin(users, eq(users.id, reviewAssignments.revieweeUserId))
    .where(and(...conds))
    .orderBy(desc(reviewAssignments.createdAt));
  return rows.map((r) => ({ ...r.assignment, revieweeName: r.revieweeName }));
}

/**
 * Submit satu respons per assignment. Double-submit ditolak: cek status
 * assignment di dalam transaksi + unique(assignment_id) di DB.
 */
export async function submitResponse(
  userId: string,
  orgId: string,
  assignmentId: string,
  answers: Record<string, unknown>,
): Promise<ReviewResponse> {
  await requireOrgRole(userId, orgId, "member");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`review:${orgId}`}))`,
    );
    const [assignment] = await tx
      .select()
      .from(reviewAssignments)
      .where(
        and(
          eq(reviewAssignments.id, assignmentId),
          eq(reviewAssignments.orgId, orgId),
        ),
      )
      .limit(1)
      .for("update");
    if (!assignment) throw new NotFoundError("Assignment tidak ditemukan.");
    if (assignment.reviewerUserId !== userId)
      throw new NotFoundError("Assignment tidak ditemukan.");
    if (assignment.status === "submitted")
      throw new Error("Anda sudah mengirim penilaian untuk orang ini.");

    const [period] = await tx
      .select()
      .from(reviewPeriods)
      .where(eq(reviewPeriods.id, assignment.periodId))
      .limit(1);
    if (!period || period.status !== "open")
      throw new Error("Periode penilaian sudah ditutup.");
    const [form] = await tx
      .select()
      .from(reviewForms)
      .where(eq(reviewForms.id, period.formId))
      .limit(1);
    const errors = validateAnswers(form.fields, answers);
    if (Object.keys(errors).length > 0) {
      throw new Error(Object.values(errors).join(" "));
    }

    const [response] = await tx
      .insert(reviewResponses)
      .values({
        orgId,
        assignmentId,
        answers,
        submittedByUserId: userId,
      })
      .returning();
    await tx
      .update(reviewAssignments)
      .set({ status: "submitted" })
      .where(eq(reviewAssignments.id, assignmentId));
    await recordAudit(
      {
        orgId,
        userId,
        action: "review.response.submit",
        entity: "review_assignment",
        entityId: assignmentId,
      },
      tx,
    );
    return response;
  });
}

/**
 * Submit publik lewat slug: tanpa login, konteks = slug form aktif +
 * assignmentId dari tautan yang dibagikan. unique(assignment_id) + flip
 * status menjamin satu kali.
 */
export async function submitPublicResponse(
  slug: string,
  assignmentId: string,
  answers: Record<string, unknown>,
): Promise<ReviewResponse> {
  return db.transaction(async (tx) => {
    const [form] = await tx
      .select()
      .from(reviewForms)
      .where(eq(reviewForms.slug, slug))
      .limit(1);
    if (!form || form.status !== "active")
      throw new NotFoundError("Form tidak ditemukan atau sudah ditutup.");

    const [assignment] = await tx
      .select()
      .from(reviewAssignments)
      .where(
        and(
          eq(reviewAssignments.id, assignmentId),
          eq(reviewAssignments.orgId, form.orgId),
        ),
      )
      .limit(1)
      .for("update");
    if (!assignment) throw new NotFoundError("Tautan tidak valid.");
    if (assignment.status === "submitted")
      throw new Error("Penilaian untuk tautan ini sudah pernah dikirim.");

    const [period] = await tx
      .select()
      .from(reviewPeriods)
      .where(eq(reviewPeriods.id, assignment.periodId))
      .limit(1);
    if (!period || period.status !== "open")
      throw new Error("Periode penilaian sudah ditutup.");

    const errors = validateAnswers(form.fields, answers);
    if (Object.keys(errors).length > 0)
      throw new Error(Object.values(errors).join(" "));

    const [response] = await tx
      .insert(reviewResponses)
      .values({ orgId: form.orgId, assignmentId, answers })
      .returning();
    await tx
      .update(reviewAssignments)
      .set({ status: "submitted" })
      .where(eq(reviewAssignments.id, assignmentId));
    return response;
  });
}

/**
 * Tutup periode: agregasi rata-rata per reviewee ditulis ke results.
 * draft->closed lewat status open; idempoten bila sudah closed.
 */
export async function closePeriod(
  userId: string,
  orgId: string,
  periodId: string,
): Promise<ReviewPeriod> {
  await requireOrgRole(userId, orgId, "member");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`review:${orgId}`}))`,
    );
    const [period] = await tx
      .select()
      .from(reviewPeriods)
      .where(
        and(eq(reviewPeriods.id, periodId), eq(reviewPeriods.orgId, orgId)),
      )
      .limit(1)
      .for("update");
    if (!period) throw new NotFoundError("Periode tidak ditemukan.");
    if (period.status === "closed") return period; // idempoten

    const rows = await tx
      .select({
        revieweeUserId: reviewAssignments.revieweeUserId,
        answers: reviewResponses.answers,
      })
      .from(reviewAssignments)
      .innerJoin(
        reviewResponses,
        eq(reviewResponses.assignmentId, reviewAssignments.id),
      )
      .where(
        and(
          eq(reviewAssignments.periodId, periodId),
          eq(reviewAssignments.orgId, orgId),
        ),
      );
    const results = Object.fromEntries(aggregate360(rows));
    const [updated] = await tx
      .update(reviewPeriods)
      .set({ status: "closed", results })
      .where(eq(reviewPeriods.id, periodId))
      .returning();
    await recordAudit(
      {
        orgId,
        userId,
        action: "review.period.close",
        entity: "review_period",
        entityId: periodId,
        metadata: { reviews: rows.length },
      },
      tx,
    );
    return updated;
  });
}

// ---------------- LMS: kursus ----------------

export async function createCourse(
  userId: string,
  orgId: string,
  input: { title: string; description?: string | null },
) {
  await requireOrgRole(userId, orgId, "member");
  const [row] = await db
    .insert(courses)
    .values({
      orgId,
      title: input.title,
      description: input.description ?? null,
      createdBy: userId,
    })
    .onConflictDoNothing({ target: [courses.orgId, courses.title] })
    .returning();
  if (!row) throw new Error("Kursus dengan judul itu sudah ada.");
  await recordAudit({
    orgId,
    userId,
    action: "lms.course.create",
    entity: "course",
    entityId: row.id,
  });
  return row;
}

export async function addMaterial(
  userId: string,
  orgId: string,
  input: { courseId: string; title: string; content: string },
) {
  await requireOrgRole(userId, orgId, "member");
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, input.courseId), eq(courses.orgId, orgId)))
    .limit(1);
  if (!course) throw new NotFoundError("Kursus tidak ditemukan.");
  const [row] = await db
    .insert(courseMaterials)
    .values({
      orgId,
      courseId: input.courseId,
      title: input.title,
      content: input.content,
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "lms.material.create",
    entity: "course_material",
    entityId: row.id,
  });
  return row;
}

/** Satu penyelesaian per (org, kursus, user); idempoten. */
export async function completeCourse(
  userId: string,
  orgId: string,
  courseId: string,
) {
  await requireOrgRole(userId, orgId, "member");
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.orgId, orgId)))
    .limit(1);
  if (!course) throw new NotFoundError("Kursus tidak ditemukan.");
  const inserted = await db
    .insert(courseCompletions)
    .values({ orgId, courseId, userId })
    .onConflictDoNothing({
      target: [
        courseCompletions.orgId,
        courseCompletions.courseId,
        courseCompletions.userId,
      ],
    })
    .returning();
  if (inserted.length > 0) {
    await recordAudit({
      orgId,
      userId,
      action: "lms.course.complete",
      entity: "course_completion",
      entityId: courseId,
    });
  }
}

export async function listCourses(orgId: string) {
  return db
    .select()
    .from(courses)
    .where(eq(courses.orgId, orgId))
    .orderBy(desc(courses.createdAt));
}

export async function listMaterials(orgId: string, courseId: string) {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.orgId, orgId)))
    .limit(1);
  if (!course) throw new NotFoundError("Kursus tidak ditemukan.");
  return db
    .select()
    .from(courseMaterials)
    .where(eq(courseMaterials.courseId, courseId))
    .orderBy(courseMaterials.createdAt);
}

export async function listCompletions(orgId: string, userId: string) {
  return db
    .select()
    .from(courseCompletions)
    .where(
      and(
        eq(courseCompletions.orgId, orgId),
        eq(courseCompletions.userId, userId),
      ),
    );
}

// ---------------- Pengumuman ----------------

export async function createAnnouncement(
  userId: string,
  orgId: string,
  input: { title: string; body: string },
) {
  await requireOrgRole(userId, orgId, "admin");
  const [row] = await db
    .insert(announcements)
    .values({ orgId, title: input.title, body: input.body, createdBy: userId })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "announcement.create",
    entity: "announcement",
    entityId: row.id,
  });
  return row;
}

export async function listAnnouncements(orgId: string) {
  return db
    .select()
    .from(announcements)
    .where(eq(announcements.orgId, orgId))
    .orderBy(desc(announcements.createdAt));
}

export async function listResponsesForPeriod(orgId: string, periodId: string) {
  return db
    .select({
      response: reviewResponses,
      assignment: reviewAssignments,
    })
    .from(reviewResponses)
    .innerJoin(
      reviewAssignments,
      eq(reviewAssignments.id, reviewResponses.assignmentId),
    )
    .where(
      and(
        eq(reviewResponses.orgId, orgId),
        eq(reviewAssignments.periodId, periodId),
      ),
    )
    .orderBy(desc(reviewResponses.submittedAt));
}
