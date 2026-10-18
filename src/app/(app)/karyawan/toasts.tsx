"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/** Render hasil server action (via searchParams) sebagai toast sonner. */
export function KaryawanToasts({ ok, error }: { ok?: string; error?: string }) {
  useEffect(() => {
    if (ok) toast.success(ok);
    if (error) toast.error(error);
  }, [ok, error]);
  return null;
}
