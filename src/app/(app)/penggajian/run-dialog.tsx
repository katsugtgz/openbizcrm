"use client";

import { useState, useTransition } from "react";
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
import { formatIDR } from "@/lib/money";
import { previewPayrollAction, runPayrollAction } from "./actions";

const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

interface Preview {
  employeeCount: number;
  totalBruto: number;
  totalNet: number;
  month: number;
  year: number;
}

/** "Jalankan Payroll": pilih periode, lihat preview total, konfirmasi. */
export function RunPayrollDialog() {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const now = new Date();

  function loadPreview(formData: FormData) {
    setError(null);
    setPreview(null);
    startTransition(async () => {
      const result = await previewPayrollAction(formData);
      if (result.ok) setPreview(result.preview);
      else setError(result.error);
    });
  }

  function run(formData: FormData) {
    startTransition(async () => {
      const result = await runPayrollAction(formData);
      setOpen(false);
      if (!result.ok) {
        setError(result.error);
        setPreview(null);
        return;
      }
      // Sukses: server action redirect -> toast via searchParams.
      window.location.href = result.redirectTo;
    });
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setPreview(null);
            setError(null);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button>Jalankan Payroll</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Jalankan Payroll</DialogTitle>
            <DialogDescription>
              Pilih periode, tinjau total, lalu konfirmasi.
            </DialogDescription>
          </DialogHeader>
          <form
            id="run-form"
            action={loadPreview}
            className="flex items-end gap-3"
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="dialog-month">Bulan</Label>
              <select
                id="dialog-month"
                name="month"
                defaultValue={now.getMonth() + 1}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dialog-year">Tahun</Label>
              <Input
                id="dialog-year"
                name="year"
                type="number"
                defaultValue={now.getFullYear()}
                className="w-24"
              />
            </div>
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? "Menghitung…" : "Tinjau"}
            </Button>
          </form>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {preview && (
            <div className="space-y-1 rounded-md border p-3 text-sm">
              <p className="text-muted-foreground">
                Karyawan aktif: {preview.employeeCount}
              </p>
              <p className="flex justify-between">
                <span>Total bruto</span>
                <span className="tabular-nums">
                  {formatIDR(preview.totalBruto)}
                </span>
              </p>
              <p className="flex justify-between font-medium">
                <span>Total diterima (net)</span>
                <span className="tabular-nums">
                  {formatIDR(preview.totalNet)}
                </span>
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <form action={run} className="contents">
              {preview && (
                <>
                  <input type="hidden" name="month" value={preview.month} />
                  <input type="hidden" name="year" value={preview.year} />
                  <Button type="submit" disabled={pending}>
                    {pending ? "Menjalankan…" : "Konfirmasi Jalankan"}
                  </Button>
                </>
              )}
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
