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
import { createAnnouncementAction } from "./actions";

export function NewAnnouncementDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createAnnouncementAction(formData);
      if (result.ok) {
        setOpen(false);
        toast.success("Pengumuman dibuat.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Pengumuman Baru</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Pengumuman Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ann-title">Judul</Label>
            <Input id="ann-title" name="title" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ann-body">Isi</Label>
            <Textarea id="ann-body" name="body" required rows={5} />
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
