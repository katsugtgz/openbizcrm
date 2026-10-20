"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { completeCourseAction, type ActionResult } from "./actions";

export function CompleteCourseButton({ courseId }: { courseId: string }) {
  const [pending, startTransition] = useTransition();

  function complete() {
    const fd = new FormData();
    fd.set("courseId", courseId);
    startTransition(async () => {
      const result: ActionResult = await completeCourseAction(fd);
      if (result.ok) toast.success(result.message ?? "Selesai.");
      else toast.error(result.error ?? "Gagal.");
    });
  }

  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={complete}>
      Tandai Selesai
    </Button>
  );
}
