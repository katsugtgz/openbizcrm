import { getFormBySlug } from "@/lib/review/service";
import { checkPublicThrottle, verifyAssignmentToken } from "@/app/r/[slug]/guard";

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
  // Tanpa token tak ada DB yang disentuh — jangan bakar budget throttle
  // (cubic pr10 r2: tokenless flood bisa menghabiskan backstop global dan
  // memblokir penilai sah). Throttle hanya untuk request ber-token.
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
  // Throttle + token gate sama seperti /r/[slug] (bughunt app:3/17):
  // per requester + backstop global (cubic pr10 r:25).
  if (
    !(await checkPublicThrottle(
      `public-form:${slug}`,
      60,
      `public-form-global:${slug}`,
      600,
    ))
  ) {
    return (
      <main className="mx-auto max-w-xl space-y-6 px-4 py-10">
        <p className="text-sm text-muted-foreground">
          Terlalu banyak permintaan. Coba lagi sebentar.
        </p>
      </main>
    );
  }
  const form = await getFormBySlug(slug);
  // Respons generik seperti /r/[slug] (cubic pr10 r:51): jangan bocorkan
  // eksistensi slug lewat notFound().
  if (!form || form.status !== "active") {
    return (
      <main className="mx-auto max-w-xl space-y-6 px-4 py-10">
        <p className="text-sm text-muted-foreground">
          Tautan tidak lengkap atau tidak valid: token penilai tidak ditemukan.
          Minta tautan personal (?a=…) dari admin Anda.
        </p>
      </main>
    );
  }
  // assignmentId di sini string (early return di atas) — tanpa cabang
  // mati (cubic pr10 r4, same-class dengan /r).
  const tokenOk = await verifyAssignmentToken(
    assignmentId,
    form.id,
    form.orgId,
  );
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
      <FormSubmit
        slug={slug}
        assignmentId={assignmentId}
        fields={form.fields}
      />
    </main>
  );
}

import { PublicSubmit } from "@/app/r/[slug]/public-submit";

function FormSubmit(props: React.ComponentProps<typeof PublicSubmit>) {
  return <PublicSubmit {...props} />;
}
