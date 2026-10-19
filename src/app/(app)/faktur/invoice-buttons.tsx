"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  cancelInvoiceAction,
  markOverdueAction,
  sendInvoiceAction,
} from "./actions";

function useAction() {
  const [pending, startTransition] = useTransition();
  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
  ) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast.success(okMsg);
      else toast.error(result.error ?? "Gagal.");
    });
  return { pending, run };
}

export function SendInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const { pending, run } = useAction();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        run(
          () => sendInvoiceAction(invoiceId),
          "Faktur terkirim; jurnal AR diposting.",
        )
      }
    >
      {pending ? "Memproses…" : "Kirim"}
    </Button>
  );
}

export function MarkOverdueButton({ invoiceId }: { invoiceId: string }) {
  const { pending, run } = useAction();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        run(() => markOverdueAction(invoiceId), "Ditandai jatuh tempo.")
      }
    >
      Tandai Jatuh Tempo
    </Button>
  );
}

export function CancelInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const { pending, run } = useAction();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        run(() => cancelInvoiceAction(invoiceId), "Faktur dibatalkan.")
      }
    >
      Batalkan
    </Button>
  );
}
