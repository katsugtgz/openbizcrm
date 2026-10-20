"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { createGroupAction, openDirectAction } from "./actions";

export interface MemberOption {
  id: string;
  label: string;
}

/** Dialog percakapan langsung 1:1 dan grup baru. */
export function NewChatDialogs({
  meId,
  members,
}: {
  meId: string;
  members: MemberOption[];
}) {
  return (
    <div className="flex gap-2">
      <DirectDialog members={members} />
      <GroupDialog meId={meId} members={members} />
    </div>
  );
}

function DirectDialog({ members }: { members: MemberOption[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await openDirectAction(fd);
      if (result.ok) {
        setOpen(false);
        // Langsung buka percakapan barunya (cubic new-chat-dialogs:54) —
        // refresh saja bisa meninggalkan percakapan lama saat ?c ada.
        router.push(`/obrolan?c=${result.conversationId}`);
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Chat Langsung
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Percakapan Langsung</DialogTitle>
            <DialogDescription>
              Pilih satu anggota; percakapan dibuat sekali per pasangan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="chat-direct-user">Anggota</Label>
            <select
              id="chat-direct-user"
              name="otherUserId"
              required
              aria-label="Pilih anggota"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
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
            <Button type="submit" disabled={pending || members.length === 0}>
              {pending ? "Memproses…" : "Buka Chat"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GroupDialog({
  meId,
  members,
}: {
  meId: string;
  members: MemberOption[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const ids = fd
      .getAll("member")
      .map(String)
      .filter((id) => id !== meId);
    fd.set("memberUserIds", JSON.stringify(ids));
    startTransition(async () => {
      const result = await createGroupAction(fd);
      if (result.ok) {
        setOpen(false);
        toast.success("Grup dibuat.");
        router.push(`/obrolan?c=${result.conversationId}`);
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Grup Baru</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Grup Baru</DialogTitle>
            <DialogDescription>
              Anda otomatis menjadi anggota grup.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="chat-group-name">Nama Grup</Label>
            <Input id="chat-group-name" name="name" required />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Anggota</legend>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
              {members.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    name="member"
                    value={m.id}
                    className="size-4"
                    aria-label={`Tambahkan ${m.label}`}
                  />
                  {m.label}
                </label>
              ))}
              {members.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Belum ada anggota lain di organisasi ini.
                </p>
              )}
            </div>
          </fieldset>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Menyimpan…" : "Buat Grup"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
