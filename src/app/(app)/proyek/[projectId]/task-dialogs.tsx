"use client";

import { useState, useTransition } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createTaskAction,
  createTemplateAction,
  deleteTemplateAction,
  generateTodayAction,
} from "@/app/(app)/proyek/actions";

export function NewTaskDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState("medium");
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    if (priority) formData.set("priority", priority);
    startTransition(async () => {
      const result = await createTaskAction(formData);
      if (result.ok) {
        setOpen(false);
        toast.success("Task dibuat.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Task Baru</Button>
      </DialogTrigger>
      <DialogContent>
        <form action={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Task Baru</DialogTitle>
          </DialogHeader>
          <input type="hidden" name="projectId" value={projectId} />
          <div className="space-y-2">
            <Label htmlFor="task-title">Judul</Label>
            <Input
              id="task-title"
              name="title"
              required
              placeholder="Setup server produksi"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Prioritas</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Rendah</SelectItem>
                  <SelectItem value="medium">Sedang</SelectItem>
                  <SelectItem value="high">Tinggi</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-due">Tenggat</Label>
              <Input id="task-due" name="dueDate" type="date" />
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

export function GenerateTodayButton({
  projectId,
  projects,
  compact,
}: {
  projectId?: string;
  projects?: { id: string; name: string }[];
  compact?: boolean;
}) {
  const [target, setTarget] = useState(projectId ?? "");
  const [pending, startTransition] = useTransition();

  function run() {
    if (!target) {
      toast.error("Pilih proyek terlebih dahulu.");
      return;
    }
    startTransition(async () => {
      const result = await generateTodayAction(target);
      if (result.ok) toast.success(`${result.created} tugas hari ini dibuat.`);
      else toast.error(result.error ?? "Gagal.");
    });
  }

  if (compact && projects) {
    return (
      <div className="flex items-end gap-2">
        <div className="w-56">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger aria-label="Proyek tujuan generate">
              <SelectValue placeholder="Pilih proyek" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={run} disabled={pending}>
          {pending ? "Membuat..." : "Generate Hari Ini"}
        </Button>
      </div>
    );
  }

  return (
    <Button onClick={run} disabled={pending} size="sm">
      {pending ? "Membuat..." : "Generate Hari Ini"}
    </Button>
  );
}

export function TemplateForm() {
  const [priority, setPriority] = useState("medium");
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    formData.set("priority", priority);
    startTransition(async () => {
      const result = await createTemplateAction(formData);
      if (result.ok) toast.success("Template ditambahkan.");
      else toast.error(result.error ?? "Gagal.");
    });
  }

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2">
      <div className="flex-1 min-w-[200px]">
        <Label htmlFor="template-name">Nama tugas</Label>
        <Input
          id="template-name"
          name="name"
          required
          placeholder="Daily standup report"
          className="mt-1"
        />
      </div>
      <div className="w-36">
        <Label>Prioritas</Label>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Rendah</SelectItem>
            <SelectItem value="medium">Sedang</SelectItem>
            <SelectItem value="high">Tinggi</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Menyimpan..." : "Tambah Template"}
      </Button>
    </form>
  );
}

export function DeleteTemplateButton({ templateId }: { templateId: string }) {
  const [pending, startTransition] = useTransition();
  function remove() {
    startTransition(async () => {
      const result = await deleteTemplateAction(templateId);
      if (result.ok) toast.success("Template dihapus.");
      else toast.error(result.error ?? "Gagal.");
    });
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-red-600"
      onClick={remove}
      disabled={pending}
    >
      Hapus
    </Button>
  );
}
