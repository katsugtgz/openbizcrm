"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  createProjectAction,
  deleteProjectAction,
  updateProjectStatusAction,
} from "@/app/(app)/proyek/actions";

const STATUS_OPTIONS = [
  { value: "planning", label: "Perencanaan" },
  { value: "active", label: "Aktif" },
  { value: "on_hold", label: "Ditahan" },
  { value: "done", label: "Selesai" },
  { value: "cancelled", label: "Dibatalkan" },
] as const;

export function NewProjectDialog({
  companies,
}: {
  companies: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [clientCompanyId, setClientCompanyId] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(formData: FormData) {
    if (clientCompanyId) formData.set("clientCompanyId", clientCompanyId);
    startTransition(async () => {
      const result = await createProjectAction(formData);
      if (result.ok) {
        setOpen(false);
        toast.success("Proyek dibuat.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Proyek Baru</Button>
      </DialogTrigger>
      <DialogContent>
        <form action={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Proyek Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="project-name">Nama</Label>
            <Input
              id="project-name"
              name="name"
              required
              placeholder="Implementasi ERP"
            />
          </div>
          <div className="space-y-2">
            <Label>Perusahaan Klien</Label>
            <Select value={clientCompanyId} onValueChange={setClientCompanyId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Opsional" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

export function ProjectStatusSelect({
  projectId,
  status,
}: {
  projectId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    startTransition(async () => {
      const result = await updateProjectStatusAction(projectId, next);
      if (result.ok) toast.success("Status proyek diperbarui.");
      else toast.error(result.error ?? "Gagal.");
    });
  }

  return (
    <Select value={status} onValueChange={change} disabled={pending}>
      <SelectTrigger className="h-8 w-36 text-xs" aria-label="Status proyek">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DeleteProjectButton({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function remove() {
    if (!window.confirm("Hapus proyek beserta semua task & timesheet?")) return;
    startTransition(async () => {
      const result = await deleteProjectAction(projectId);
      if (result.ok) {
        toast.success("Proyek dihapus.");
        router.push("/proyek");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Button variant="destructive" size="sm" onClick={remove} disabled={pending}>
      {pending ? "Menghapus..." : "Hapus"}
    </Button>
  );
}
