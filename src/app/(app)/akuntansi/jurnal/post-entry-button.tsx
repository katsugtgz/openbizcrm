"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { postEntryAction } from "../actions";

export function PostEntryButton({ entryId }: { entryId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await postEntryAction(entryId);
          if (result.ok) toast.success("Entri diposting.");
          else toast.error(result.error ?? "Gagal posting.");
        });
      }}
    >
      {pending ? "Memproses…" : "Posting"}
    </Button>
  );
}
