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
  createCompanyAction,
  createContactAction,
} from "@/app/(app)/crm/actions";

export function NewCompanyDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // onSubmit + preventDefault: form action React 19 me-reset uncontrolled
  // input meski submit gagal (cubic P2 perusahaan-dialogs:43).
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createCompanyAction(formData);
      if (result.ok) {
        setOpen(false);
        toast.success("Perusahaan ditambahkan.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Perusahaan Baru</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Perusahaan Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="company-name">Nama</Label>
            <Input
              id="company-name"
              name="name"
              required
              placeholder="PT Maju Jaya"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-industry">Industri</Label>
            <Input
              id="company-industry"
              name="industry"
              placeholder="Manufaktur"
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

export function NewContactDialog({
  companies,
}: {
  companies: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [pending, startTransition] = useTransition();

  // onSubmit + preventDefault: sama dengan NewCompanyDialog — jaga input
  // pengguna saat submit gagal (cubic P2 perusahaan-dialogs:43).
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!companyId) {
      toast.error("Pilih perusahaan terlebih dahulu.");
      return;
    }
    const formData = new FormData(e.currentTarget);
    formData.set("companyId", companyId);
    startTransition(async () => {
      const result = await createContactAction(formData);
      if (result.ok) {
        setOpen(false);
        toast.success("Kontak ditambahkan.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Kontak Baru</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Kontak Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Perusahaan</Label>
            <select
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              aria-label="Perusahaan kontak"
            >
              <option value="">Pilih perusahaan</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-name">Nama</Label>
            <Input
              id="contact-name"
              name="name"
              required
              placeholder="Budi Santoso"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                name="email"
                type="email"
                placeholder="budi@pt.co.id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-phone">Telepon</Label>
              <Input id="contact-phone" name="phone" placeholder="0812xxxx" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-position">Jabatan</Label>
            <Input
              id="contact-position"
              name="position"
              placeholder="Manajer Pembelian"
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
