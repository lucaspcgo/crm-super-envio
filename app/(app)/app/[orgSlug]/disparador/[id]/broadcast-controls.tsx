"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  cancelBroadcastAction,
  pauseBroadcastAction,
  resumeBroadcastAction,
} from "@/lib/broadcasts/actions";

type Props = { orgSlug: string; id: string; status: string };

export function BroadcastControls({ orgSlug, id, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, okMsg: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(okMsg);
      router.refresh();
    });
  }

  const isActive = status === "running" || status === "paused";
  if (!isActive) return null;

  return (
    <div className="flex gap-2">
      {status === "running" && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => pauseBroadcastAction(orgSlug, id), "Disparo pausado.")}
        >
          Pausar
        </Button>
      )}
      {status === "paused" && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => resumeBroadcastAction(orgSlug, id), "Disparo retomado.")}
        >
          Retomar
        </Button>
      )}
      <Button
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() => run(() => cancelBroadcastAction(orgSlug, id), "Disparo cancelado.")}
      >
        Cancelar
      </Button>
    </div>
  );
}
