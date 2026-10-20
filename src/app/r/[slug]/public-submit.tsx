"use client";

import { useState } from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitPublicResponseAction } from "@/app/(app)/penilaian/actions";
import type { ReviewFormField } from "@/db/schema";

/**
 * Render field sesuai definisi form (text/textarea/number/select/checkbox),
 * kumpulkan jawaban, kirim sebagai JSON ke action publik.
 */
export function PublicSubmit({
  slug,
  assignmentId,
  fields,
}: {
  slug: string;
  assignmentId: string;
  fields: ReviewFormField[];
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const answers: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = fd.get(f.key);
      if (f.type === "checkbox") answers[f.key] = raw === "on";
      else if (f.type === "number")
        // Kosong tetap kosong (cubic public-submit.tsx:37) — Number("") = 0
        // menyimpan jawaban palsu atau gagal validasi min.
        answers[f.key] = raw === null || raw === "" ? "" : Number(raw);
      else answers[f.key] = raw ?? "";
    }
    const payload = new FormData();
    payload.set("slug", slug);
    payload.set("assignmentId", assignmentId);
    payload.set("answers", JSON.stringify(answers));
    startTransition(async () => {
      const result = await submitPublicResponseAction(payload);
      if (result.ok) {
        setDone(true);
        toast.success(result.message ?? "Terkirim.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  if (done) {
    return (
      <p className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        Terima kasih, penilaian Anda sudah diterima.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {fields.map((f) => (
        <div key={f.key} className="space-y-2">
          {f.type === "checkbox" ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={f.key}
                required={f.required}
                aria-label={f.label}
                className="h-4 w-4"
              />
              {f.label}
              {f.required && <span className="text-red-600">*</span>}
            </label>
          ) : (
            <>
              <Label htmlFor={`pub-${f.key}`}>
                {f.label}
                {f.required && <span className="text-red-600"> *</span>}
              </Label>
              {f.type === "textarea" && (
                <Textarea
                  id={`pub-${f.key}`}
                  name={f.key}
                  required={f.required}
                  aria-label={f.label}
                  rows={4}
                />
              )}
              {f.type === "text" && (
                <Input
                  id={`pub-${f.key}`}
                  name={f.key}
                  required={f.required}
                  aria-label={f.label}
                />
              )}
              {f.type === "number" && (
                <Input
                  id={`pub-${f.key}`}
                  name={f.key}
                  type="number"
                  min={f.min}
                  max={f.max}
                  required={f.required}
                  aria-label={f.label}
                  className="tabular-nums"
                />
              )}
              {f.type === "select" && (
                <select
                  id={`pub-${f.key}`}
                  name={f.key}
                  required={f.required}
                  aria-label={f.label}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">— Pilih —</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>
      ))}
      <Button type="submit" disabled={pending}>
        {pending ? "Mengirim..." : "Kirim Penilaian"}
      </Button>
    </form>
  );
}
