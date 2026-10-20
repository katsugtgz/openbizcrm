"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendMessageAction } from "./actions";

export interface ChatMessageView {
  id: string;
  name: string;
  body: string;
  at: string;
  mine: boolean;
}

/**
 * Ruang pesan satu percakapan. Pengiriman lewat server action; daftar
 * diperbarui dengan router.refresh() (server re-render).
 */
export function ChatRoom({
  conversationId,
  messages,
}: {
  conversationId: string;
  messages: ChatMessageView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("conversationId", conversationId);
    if (!String(fd.get("body") ?? "").trim()) return;
    e.currentTarget.reset();
    startTransition(async () => {
      const result = await sendMessageAction(fd);
      if (!result.ok) {
        toast.error(result.error ?? "Gagal mengirim.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex h-[70vh] flex-col rounded-md border">
      <ul aria-label="Pesan" className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <li className="text-sm text-muted-foreground">Belum ada pesan.</li>
        )}
        {messages.map((m) => (
          <li key={m.id} className={m.mine ? "text-right" : ""}>
            <p className="text-xs text-muted-foreground">
              {m.name} · {m.at}
            </p>
            <p className="inline-block max-w-[80%] whitespace-pre-wrap rounded-md bg-accent px-3 py-1.5 text-left text-sm">
              {m.body}
            </p>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="flex gap-2 border-t p-3">
        <Input
          name="body"
          aria-label="Tulis pesan"
          placeholder="Tulis pesan…"
          autoComplete="off"
          required
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Mengirim…" : "Kirim"}
        </Button>
      </form>
    </div>
  );
}
