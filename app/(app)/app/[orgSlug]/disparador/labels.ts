type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export const BROADCAST_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: "Rascunho", variant: "outline" },
  running: { label: "Enviando", variant: "default" },
  paused: { label: "Pausado", variant: "secondary" },
  done: { label: "Concluído", variant: "secondary" },
  failed: { label: "Falhou", variant: "destructive" },
  canceled: { label: "Cancelado", variant: "outline" },
};

export const TARGET_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  queued: { label: "Na fila", variant: "outline" },
  sending: { label: "Enviando", variant: "default" },
  sent: { label: "Enviado", variant: "secondary" },
  failed: { label: "Falhou", variant: "destructive" },
  skipped: { label: "Pulado", variant: "outline" },
};

export function statusInfo(
  map: Record<string, { label: string; variant: BadgeVariant }>,
  status: string,
): { label: string; variant: BadgeVariant } {
  return map[status] ?? { label: status, variant: "outline" };
}
