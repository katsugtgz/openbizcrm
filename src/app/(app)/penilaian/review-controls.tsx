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
 * Dialog isi penilaian: field dikirim sesuai definisi form (disederhanakan:
 * setiap field textarea tunggal + skor number; definisi penuh di form JSON).
 * Jawaban dikirim sebagai JSON ke action.
 */
export function SubmitReviewForm({ assignmentId }: { assignmentId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const answers = {
      skor: Number(fd.get("skor") ?? 0),
      kekuatan: String(fd.get("kekuatan") ?? ""),
      perbaikan: String(fd.get("perbaikan") ?? ""),
    };
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
              Skor 1-5 dan catatan kualitatif.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`skor-${assignmentId}`}>Skor (1-5)</Label>
            <input
              id={`skor-${assignmentId}`}
              name="skor"
              type="number"
              min={1}
              max={5}
              required
              aria-label="Skor keseluruhan"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`kekuatan-${assignmentId}`}>Kekuatan</Label>
            <Textarea
              id={`kekuatan-${assignmentId}`}
              name="kekuatan"
              required
              aria-label="Kekuatan"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`perbaikan-${assignmentId}`}>Area Perbaikan</Label>
            <Textarea
              id={`perbaikan-${assignmentId}`}
              name="perbaikan"
              aria-label="Area perbaikan"
            />
          </div>
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
