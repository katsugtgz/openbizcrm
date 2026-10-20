import { notFound } from "next/navigation";
import { getFormBySlug } from "@/lib/review/service";

export const metadata = { title: "Formulir" };

/** Public form: request-time DB lookup, blocking route (pola /r/[slug]). */
export const instant = false;

/**
 * Alias publik /f/<slug> untuk /r/<slug> (tautan formulir tanpa login).
 * Submit butuh token penilai (?a=<assignmentId>) — sama dengan /r/<slug>.
 */
export default async function PublicFormPage({
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
      {assignmentId ? (
        <FormSubmit
          slug={slug}
          assignmentId={assignmentId}
          fields={form.fields}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Tautan tidak lengkap: token penilai tidak ditemukan. Minta tautan
          personal (?a=…) dari admin Anda.
        </p>
      )}
    </main>
  );
}

import { PublicSubmit } from "@/app/r/[slug]/public-submit";

function FormSubmit(props: React.ComponentProps<typeof PublicSubmit>) {
  return <PublicSubmit {...props} />;
}
