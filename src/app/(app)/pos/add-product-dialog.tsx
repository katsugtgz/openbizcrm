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
import { addProductAction } from "./actions";

export function AddProductDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await addProductAction(formData);
      if (result.ok) {
        setOpen(false);
        toast.success("Produk ditambahkan.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Produk Baru</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Produk Baru</DialogTitle>
            <DialogDescription>
              SKU unik per organisasi; harga rupiah bulat.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="prod-name">Nama</Label>
            <Input
              id="prod-name"
              name="name"
              required
              placeholder="Kopi Susu"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="prod-sku">SKU</Label>
              <Input
                id="prod-sku"
                name="sku"
                required
                placeholder="KPS-001"
                className="font-mono"
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-stock">Stok awal</Label>
              <Input
                id="prod-stock"
                name="initialStock"
                type="number"
                min={0}
                step={1}
                defaultValue={0}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="prod-price">Harga jual (Rp)</Label>
            <Input
              id="prod-price"
              name="price"
              inputMode="numeric"
              required
              placeholder="18000"
              className="tabular-nums"
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
