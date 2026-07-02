"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Enquanto o disparo está ativo (running/paused), atualiza a página sozinho
 * a cada `intervalMs` pra o relatório acompanhar o progresso ao vivo.
 */
export function AutoRefresh({
  active,
  intervalMs = 4000,
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      router.refresh();
      setTick((t) => t + 1);
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);

  if (!active) {
    return (
      <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
        finalizado
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
      atualizando ao vivo{tick > 0 ? ` · ${tick}` : ""}
    </span>
  );
}
