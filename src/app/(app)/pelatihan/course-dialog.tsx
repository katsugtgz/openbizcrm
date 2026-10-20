"use client";

import { useState } from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addMaterialAction, createCourseAction } from "./actions";

export function NewCourseDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createCourseAction(formData);
      if (result.ok) {
        setOpen(false);
        toast.success("Kursus dibuat.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Kursus Baru</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Kursus Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="course-title">Judul</Label>
            <Input
              id="course-title"
              name="title"
              required
              placeholder="Onboarding"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="course-desc">Deskripsi</Label>
            <Textarea id="course-desc" name="description" rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="course-material">Materi Pertama</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input
                id="course-material"
                name="materialTitle"
                placeholder="Judul materi"
                className="col-span-1"
                aria-label="Judul materi"
              />
              <Input
                name="materialContent"
                placeholder="Isi materi"
                className="col-span-2"
                aria-label="Isi materi"
              />
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
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddMaterialButton({ courseId }: { courseId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("courseId", courseId);
    startTransition(async () => {
      const result = await addMaterialAction(formData);
      if (result.ok) {
        setOpen(false);
        toast.success("Materi ditambah.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Materi
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Tambah Materi</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`material-title-${courseId}`}>Judul</Label>
            <Input id={`material-title-${courseId}`} name="title" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`material-content-${courseId}`}>Isi</Label>
            <Textarea
              id={`material-content-${courseId}`}
              name="content"
              required
              rows={6}
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
