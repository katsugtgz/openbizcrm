"use client";

import React from "react";
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

  // Fallback realtime (cubic chat-room.tsx:50): polling ringan saat terlihat —
  // realtime Ably belum ada subscriber di klien, jadi router.refresh() tiap
  // 5 dtk menjaga pesan masuk terlihat tanpa navigasi. Tab tersembunyi tidak
  // ikut refetch (visibility check); refresh sekali saat tab kembali tampak.
  React.useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      router.refresh();
    }, 5000);
    const onVisible = () => {
      if (!document.hidden) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  // Satu kunci idempotensi per draf (cubic pr10 chat:339): stabil di
  // double-click/retry, diganti hanya setelah sukses terkirim. Diisi di
  // effect (bukan render) agar lolos react-hooks/purity.
  const draftKey = React.useRef<string>("");
  // Teks yang diikat kunci draf saat ini (cubic pr10 r4): kunci
  // idempotensi mengikat SATU teks — retry dengan teks edit memakai
  // kunci lama akan ditolak server sebagai mismatch.
  const draftText = React.useRef<string>("");
  React.useEffect(() => {
    if (!draftKey.current) draftKey.current = newClientMsgId();
  }, []);
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("conversationId", conversationId);
    const body = String(fd.get("body") ?? "");
    if (!body.trim()) return;
    // Rotasi kunci saat teks berubah (cubic pr10 r4): draf yang diedit
    // setelah kirim gagal harus memakai kunci baru, kalau tidak error
    // mismatch server akan berulang selamanya.
    if (draftText.current !== "" && body !== draftText.current) {
      draftKey.current = newClientMsgId();
    }
    draftText.current = body;
    fd.set("clientMsgId", draftKey.current);
    startTransition(async () => {
      const result = await sendMessageAction(fd);
      if (!result.ok) {
        toast.error(result.error ?? "Gagal mengirim.");
        return;
      }
      // Reset HANYA setelah sukses (cubic chat-room.tsx:37) — teks user
      // tidak hilang saat pengiriman ditolak.
      form.reset();
      draftKey.current = newClientMsgId();
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

/**
 * ID idempotensi klien (cubic pr10 r3:9109): crypto.randomUUID hanya ada
 * di konteks aman (HTTPS/localhost); fallback timestamp+acak agar halaman
 * chat tak crash di LAN http. Dipakai di effect/handler (bukan render).
 */
function newClientMsgId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}
