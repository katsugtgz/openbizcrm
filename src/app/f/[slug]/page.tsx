import { notFound } from "next/navigation";
import { getFormBySlug } from "@/lib/review/service";
import { checkThrottle, verifyAssignmentToken } from "@/app/r/[slug]/guard";

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
  // Throttle + token gate sama seperti /r/[slug] (bughunt app:3/17).
  if (!checkThrottle(`public-form:${slug}`, 60)) {
    return (
      <main className="mx-auto max-w-xl space-y-6 px-4 py-10">
        <p className="text-sm text-muted-foreground">
          Terlalu banyak permintaan. Coba lagi sebentar.
        </p>
      </main>
    );
  }
  // Tanpa token: respons generik TANPA query DB — slug valid/tidak valid
  // tak bisa dibedakan (tutup oracle eksistensi form aktif lintas-org).
  if (!assignmentId) {
    return (
      <main className="mx-auto max-w-xl space-y-6 px-4 py-10">
        <p className="text-sm text-muted-foreground">
          Tautan tidak lengkap atau tidak valid: token penilai tidak ditemukan.
          Minta tautan personal (?a=…) dari admin Anda.
        </p>
      </main>
    );
  }
  const form = await getFormBySlug(slug);
  if (!form || form.status !== "active") notFound();
  const tokenOk = assignmentId
    ? await verifyAssignmentToken(assignmentId, form.id, form.orgId)
    : false;
  if (!tokenOk) {
    return (
      <main className="mx-auto max-w-xl space-y-6 px-4 py-10">
        <p className="text-sm text-muted-foreground">
          Tautan tidak lengkap atau tidak valid: token penilai tidak ditemukan.
          Minta tautan personal (?a=…) dari admin Anda.
        </p>
      </main>
    );
  }

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
