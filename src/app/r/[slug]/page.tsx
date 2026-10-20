import { notFound } from "next/navigation";
import { getFormBySlug } from "@/lib/review/service";
import { PublicSubmit } from "./public-submit";

export const metadata = { title: "Penilaian" };

/** Halaman publik runtime (DB + searchParams): blocking, bukan shell statis. */
export const instant = false;

/**
 * Halaman publik penilaian lewat slug form aktif + token assignment
 * (?a=<assignmentId>). Tanpa login; field dirender sesuai definisi form.
 */
export default async function PublicReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ a?: string }>;
}) {
  const { slug } = await params;
  const { a: assignmentId } = await searchParams;
  const form = await getFormBySlug(slug);
  if (!form || form.status !== "active") notFound();

  return (
    <main className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">{form.title}</h1>
        {form.description && (
          <p className="mt-1 text-sm text-muted-foreground">
            {form.description}
          </p>
        )}
      </div>
      {form.status === "active" && assignmentId ? (
        <PublicSubmit
          slug={slug}
          assignmentId={assignmentId}
          fields={form.fields}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {form.status !== "active"
            ? "Form ini sudah ditutup."
            : "Tautan tidak lengkap: token penilai tidak ditemukan."}
        </p>
      )}
    </main>
  );
}
