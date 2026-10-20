"use client";

import { useState } from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { ReviewFormField } from "@/db/schema";
import {
  closeFormAction,
  closePeriodAction,
  publishFormAction,
  submitResponseAction,
  type ActionResult,
} from "./actions";

/** Publish / tutup form; link publik muncul setelah publish. */
export function ReviewFormActions({
  form,
}: {
  form: { id: string; status: string; slug: string | null };
}) {
  const [pending, startTransition] = useTransition();

  function run(action: (fd: FormData) => Promise<ActionResult>) {
    const fd = new FormData();
    fd.set("id", form.id);
    startTransition(async () => {
      const result = await action(fd);
      if (result.ok) toast.success(result.message ?? "Berhasil.");
      else toast.error(result.error ?? "Gagal.");
    });
  }

  return (
    <div className="flex items-center gap-1">
      {form.status === "draft" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(publishFormAction)}
        >
          Publish
        </Button>
      )}
      {form.status === "active" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(closeFormAction)}
        >
          Tutup
        </Button>
      )}
      {form.slug && (
        <a
          href={`/r/${form.slug}`}
          className="text-xs text-muted-foreground underline"
          aria-label="Buka tautan publik"
        >
          Tautan publik
        </a>
      )}
    </div>
  );
}

/** Tutup periode -> agregat rata-rata ditulis. */
export function PeriodActions({ period }: { period: { id: string } }) {
  const [pending, startTransition] = useTransition();

  function close() {
    const fd = new FormData();
    fd.set("id", period.id);
    startTransition(async () => {
      const result = await closePeriodAction(fd);
      if (result.ok) toast.success(result.message ?? "Periode ditutup.");
      else toast.error(result.error ?? "Gagal.");
    });
  }

  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={close}>
      Tutup Periode
    </Button>
  );
}

/**
 * Dialog isi penilaian: field dirender sesuai definisi form terkait
 * (text/textarea/number/select/checkbox), jawaban dikumpulkan sebagai JSON
 * ke action. Skor number dibaca Number(); checkbox boolean.
 */
export function SubmitReviewForm({
  assignmentId,
  fields,
}: {
  assignmentId: string;
  fields: ReviewFormField[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const answers: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = fd.get(f.key);
      if (f.type === "checkbox") answers[f.key] = raw === "on";
      else if (f.type === "number")
        answers[f.key] = raw === null || raw === "" ? "" : Number(raw);
      else answers[f.key] = raw ?? "";
    }
    const payload = new FormData();
    payload.set("assignmentId", assignmentId);
    payload.set("answers", JSON.stringify(answers));
    startTransition(async () => {
      const result = await submitResponseAction(payload);
      if (result.ok) {
        setOpen(false);
        toast.success(result.message ?? "Terkirim.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Isi</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Isi Penilaian</DialogTitle>
            <DialogDescription>
              Isi semua pertanyaan sesuai form penilaian.
            </DialogDescription>
          </DialogHeader>
          {fields.map((f) => (
            <div key={f.key} className="space-y-2">
              {f.type === "checkbox" ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={f.key}
                    aria-label={f.label}
                    className="h-4 w-4"
                  />
                  {f.label}
                  {f.required && <span className="text-red-600">*</span>}
                </label>
              ) : (
                <>
                  <Label htmlFor={`${f.key}-${assignmentId}`}>
                    {f.label}
                    {f.required && <span className="text-red-600"> *</span>}
                  </Label>
                  {f.type === "textarea" && (
                    <Textarea
                      id={`${f.key}-${assignmentId}`}
                      name={f.key}
                      required={f.required}
                      aria-label={f.label}
                      rows={4}
                    />
                  )}
                  {f.type === "text" && (
                    <Input
                      id={`${f.key}-${assignmentId}`}
                      name={f.key}
                      required={f.required}
                      aria-label={f.label}
                    />
                  )}
                  {f.type === "number" && (
                    <Input
                      id={`${f.key}-${assignmentId}`}
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
                      id={`${f.key}-${assignmentId}`}
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Mengirim..." : "Kirim"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
