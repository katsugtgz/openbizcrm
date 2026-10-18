"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { checkInAction, checkOutAction } from "./actions";

/** Klien geolokasi: wrapper navigator.geolocation + tombol presensi. */
export function PresensiForm() {
  const [pending, startTransition] = useTransition();

  function locate(): Promise<GeolocationPosition | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        () => resolve(null),
        { timeout: 10_000 },
      );
    });
  }

  function run(kind: "in" | "out") {
    startTransition(async () => {
      if (kind === "out") {
        const result = await checkOutAction();
        if (result.ok) toast.success(result.message);
        else toast.error(result.error);
        return;
      }
      const pos = await locate();
      const gps = pos
        ? {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          }
        : null;
      const result = await checkInAction(gps);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex gap-3">
      <Button onClick={() => run("in")} disabled={pending}>
        {pending ? "Memproses…" : "Presensi Masuk"}
      </Button>
      <Button variant="outline" onClick={() => run("out")} disabled={pending}>
        Presensi Keluar
      </Button>
    </div>
  );
}
