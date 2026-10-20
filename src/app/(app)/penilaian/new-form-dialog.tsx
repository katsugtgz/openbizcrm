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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createFormAction,
  createPeriodAction,
  type ActionResult,
} from "./actions";

const DEFAULT_FIELDS = JSON.stringify([
  {
    key: "skor",
    label: "Skor keseluruhan (1-5)",
    type: "number",
    required: true,
    min: 1,
    max: 5,
  },
  { key: "kekuatan", label: "Kekuatan", type: "textarea", required: true },
  {
    key: "perbaikan",
    label: "Area perbaikan",
    type: "textarea",
    required: false,
  },
] satisfies unknown[]);

/** Form baru: fields dikirim sebagai JSON (bisa diedit power user). */
export function NewFormDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createFormAction(formData);
      if (result.ok) {
        setOpen(false);
        toast.success("Form dibuat.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Form Baru</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Form Penilaian Baru</DialogTitle>
            <DialogDescription>
              Field disimpan sebagai JSON: key, label, type
              (text/textarea/number/select/checkbox), required, min/max,
              options.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="review-form-title">Judul</Label>
            <Input
              id="review-form-title"
              name="title"
              required
              placeholder="Review Kinerja Q4"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="review-form-desc">Deskripsi</Label>
            <Input
              id="review-form-desc"
              name="description"
              placeholder="Opsional"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="review-form-fields">Definisi Field (JSON)</Label>
            <Textarea
              id="review-form-fields"
              name="fields"
              required
              aria-label="Definisi field JSON"
              rows={8}
              className="font-mono text-xs"
              defaultValue={DEFAULT_FIELDS}
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
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Periode baru dari form aktif. */
export function NewPeriodDialog({
  forms,
}: {
  forms: { id: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result: ActionResult = await createPeriodAction(formData);
      if (result.ok) {
        setOpen(false);
        toast.success("Periode dibuka.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Periode Baru
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Buka Periode Penilaian</DialogTitle>
            <DialogDescription>
              Pilih form aktif dan rentang tanggal (opsional).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="period-title">Judul Periode</Label>
            <Input
              id="period-title"
              name="title"
              required
              placeholder="Q4 2026"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="period-form">Form</Label>
            <select
              id="period-form"
              name="formId"
              required
              aria-label="Form penilaian"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="period-start">Mulai</Label>
              <Input id="period-start" name="startDate" type="date" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="period-end">Selesai</Label>
              <Input id="period-end" name="endDate" type="date" />
            </div>
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
              {pending ? "Menyimpan..." : "Buka Periode"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
