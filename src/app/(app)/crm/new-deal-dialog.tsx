"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createDealAction,
  listCompanyContactsAction,
} from "@/app/(app)/crm/actions";

export function NewDealDialog({
  companies,
}: {
  companies: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  // Kontrol manual: form action React 19 me-reset uncontrolled input meski
  // submit gagal, jadi judul/nilai diketik hilang (cubic P2 new-deal:61).
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [contactId, setContactId] = useState("");
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([]);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Kontak dimuat per perusahaan terpilih (tanpa ini contactId selalu null).
  function handleCompanyChange(v: string) {
    setCompanyId(v);
    setContactId("");
    if (!v) setContacts([]);
  }
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    listCompanyContactsAction(companyId).then(
      (rows) => {
        if (!cancelled) setContacts(rows);
      },
      () => {
        if (!cancelled) setContacts([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  function submit(formData: FormData) {
    if (!companyId) {
      toast.error("Pilih perusahaan terlebih dahulu.");
      return;
    }
    formData.set("companyId", companyId);
    formData.set("contactId", contactId);
    startTransition(async () => {
      const result = await createDealAction(formData);
      if (result.ok) {
        setOpen(false);
        setCompanyId("");
        setTitle("");
        setValue("");
        setContactId("");
        setContacts([]);
        toast.success("Deal dibuat.");
        if (result.redirectTo) router.push(result.redirectTo);
      } else {
        toast.error(result.error ?? "Gagal membuat deal.");
      }
    });
  }

  // Reset saat ditutup dengan cara mana pun (Cancel, X, klik luar), bukan
  // hanya setelah submit sukses — data deal yang terbengkalai tidak boleh
  // muncul lagi saat dialog dibuka ulang.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setCompanyId("");
      setTitle("");
      setValue("");
      setContactId("");
      setContacts([]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>Deal Baru</Button>
      </DialogTrigger>
      <DialogContent>
        <form action={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Deal Baru</DialogTitle>
            <DialogDescription>
              Deal masuk ke tahap pertama pipeline perusahaan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="deal-company">Perusahaan</Label>
            <Select
              value={companyId}
              onValueChange={handleCompanyChange}
              name="companyId"
            >
              <SelectTrigger id="deal-company" className="w-full">
                <SelectValue placeholder="Pilih perusahaan" />
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
          <div className="space-y-2">
            <Label htmlFor="deal-title">Judul</Label>
            <Input
              id="deal-title"
              name="title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Proyek ERP ABC"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="deal-value">Nilai (Rp)</Label>
            <Input
              id="deal-value"
              name="value"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="15000000"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="deal-contact">Kontak (opsional)</Label>
            <Select
              value={contactId}
              onValueChange={setContactId}
              name="contactId"
              disabled={!companyId || contacts.length === 0}
            >
              <SelectTrigger id="deal-contact" className="w-full">
                <SelectValue
                  placeholder={
                    !companyId
                      ? "Pilih perusahaan dahulu"
                      : contacts.length === 0
                        ? "Tidak ada kontak"
                        : "Pilih kontak"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {contacts.map((c) => (
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
