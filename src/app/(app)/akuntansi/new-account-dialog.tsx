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
import { createAccountAction } from "./actions";

const TYPES = [
  { value: "asset", label: "Aset" },
  { value: "liability", label: "Liabilitas" },
  { value: "equity", label: "Ekuitas" },
  { value: "revenue", label: "Pendapatan" },
  { value: "expense", label: "Beban" },
] as const;

export function NewAccountDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // onSubmit + preventDefault: jaga input pengguna saat submit gagal
  // (pola perusahaan-dialogs:43).
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createAccountAction(formData);
      if (result.ok) {
        setOpen(false);
        toast.success("Akun ditambahkan.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Akun Baru
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Akun Baru</DialogTitle>
            <DialogDescription>
              Gunakan kode berjenjang, mis. 1-1000 Kas, 4-1000 Pendapatan.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="account-code">Kode</Label>
              <Input
                id="account-code"
                name="code"
                required
                placeholder="1-1000"
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-type">Tipe</Label>
              <select
                id="account-type"
                name="type"
                required
                aria-label="Tipe akun"
                defaultValue="asset"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-name">Nama</Label>
            <Input id="account-name" name="name" required placeholder="Kas" />
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
