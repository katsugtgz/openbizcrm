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
import { jakartaDateISO } from "@/lib/attendance/rules";
import { disposeAssetAction } from "../actions";

export function DisposeAssetButton({ assetId }: { assetId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("assetId", assetId);
    startTransition(async () => {
      const result = await disposeAssetAction(formData);
      if (result.ok) {
        setOpen(false);
        toast.success("Aset ditandai disposed.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Dispose
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Dispose Aset</DialogTitle>
            <DialogDescription>
              Menandai aset non-aktif. Tidak menghasilkan jurnal penjualan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dispose-date">Tanggal disposal</Label>
            <Input
              id="dispose-date"
              name="disposalDate"
              type="date"
              required
              defaultValue={jakartaDateISO(new Date())}
              aria-label="Tanggal disposal (WIB)"
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
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Memproses…" : "Dispose"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
