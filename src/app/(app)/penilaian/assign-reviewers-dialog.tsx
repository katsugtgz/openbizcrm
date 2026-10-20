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
import { assignReviewersAction, type ActionResult } from "./actions";

type MemberOption = { id: string; label: string };

/**
 * Auto-assign penilai untuk periode open: pasangan self + peer pertama
 * untuk tiap anggota (pola assignReviewers). Reviewer lain bisa ditambah
 * lewat pengiriman ulang dialog.
 */
export function AssignReviewersDialog({
  periodId,
  members,
}: {
  periodId: string;
  members: MemberOption[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const reviewee = String(fd.get("revieweeUserId") ?? "");
    const reviewer = String(fd.get("reviewerUserId") ?? "");
    const relation = String(fd.get("relation") ?? "peer");
    const pairs = [
      { revieweeUserId: reviewee, reviewerUserId: reviewer, relation },
    ];
    const payload = new FormData();
    payload.set("periodId", periodId);
    payload.set("pairs", JSON.stringify(pairs));
    startTransition(async () => {
      const result: ActionResult = await assignReviewersAction(payload);
      if (result.ok) {
        setOpen(false);
        toast.success(result.message ?? "Assignment dibuat.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Tambah Penilai
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Tambah Penilai</DialogTitle>
            <DialogDescription>
              Pilih yang menilai dan yang dinilai.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`reviewee-${periodId}`}>Yang dinilai</Label>
            <select
              id={`reviewee-${periodId}`}
              name="revieweeUserId"
              required
              aria-label="Yang dinilai"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`reviewer-${periodId}`}>Penilai</Label>
            <select
              id={`reviewer-${periodId}`}
              name="reviewerUserId"
              required
              aria-label="Penilai"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`relation-${periodId}`}>Relasi</Label>
            <select
              id={`relation-${periodId}`}
              name="relation"
              defaultValue="peer"
              aria-label="Relasi"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="self">Diri sendiri</option>
              <option value="peer">Rekan</option>
              <option value="supervisor">Atasan</option>
              <option value="subordinate">Bawahan</option>
            </select>
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
