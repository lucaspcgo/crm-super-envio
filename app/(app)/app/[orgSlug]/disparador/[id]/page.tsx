import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgRole } from "@/lib/auth/guards";
import { getBroadcast, getBroadcastTargets } from "@/lib/broadcasts/queries";
import { BROADCAST_STATUS, statusInfo, TARGET_STATUS } from "../labels";
import { AutoRefresh } from "./auto-refresh";
import { BroadcastControls } from "./broadcast-controls";
import { BroadcastProgressChart } from "./broadcast-progress-chart";
import { ReportRefresh } from "./report-refresh";

type Props = { params: Promise<{ orgSlug: string; id: string }> };

const MAX_ROWS = 300;

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function BroadcastDetailPage({ params }: Props) {
  const { orgSlug, id } = await params;
  const { org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });

  const broadcast = await getBroadcast(org.id, id);
  if (!broadcast) notFound();

  const targets = await getBroadcastTargets(org.id, id);
  const info = statusInfo(BROADCAST_STATUS, broadcast.status);
  const sent = broadcast.sent_count;
  const failed = broadcast.failed_count;
  const done = sent + failed;
  const remaining = Math.max(0, broadcast.total_targets - done);
  const pct = broadcast.total_targets > 0 ? Math.round((done / broadcast.total_targets) * 100) : 0;
  const active = broadcast.status === "running" || broadcast.status === "paused";

  return (
    <div className="max-w-3xl space-y-8">
      <Button
        render={<Link href={`/app/${orgSlug}/disparador`} />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Voltar
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <span className="label-mono">/ disparo</span>
          <div className="flex items-center gap-2">
            <h1 className="font-semibold text-3xl tracking-tight">{broadcast.name}</h1>
            <Badge variant={info.variant}>{info.label}</Badge>
          </div>
        </div>
        <BroadcastControls orgSlug={orgSlug} id={broadcast.id} status={broadcast.status} />
      </div>

      {/* Progresso + gráfico */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ progresso</CardTitle>
          <div className="flex items-center gap-3">
            <AutoRefresh active={active} />
            <ReportRefresh />
          </div>
        </CardHeader>
        <CardContent className="p-5">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
            <BroadcastProgressChart sent={sent} failed={failed} remaining={remaining} />

            <div className="w-full flex-1 space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold text-2xl tabular-nums">
                  {done}
                  <span className="text-lg text-muted-foreground">
                    {" "}
                    / {broadcast.total_targets}
                  </span>
                </span>
                <span className="font-mono text-muted-foreground text-xs">{pct}%</span>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="space-y-1.5 pt-1">
                <LegendRow color="var(--color-chart-1)" label="Enviados (concluído)" value={sent} />
                <LegendRow
                  color="var(--color-destructive)"
                  label="Falhas (não concluído)"
                  value={failed}
                />
                <LegendRow
                  color="var(--color-muted-foreground)"
                  label="Restantes na fila"
                  value={remaining}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Relatório */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ relatório</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {targets.length === 0 ? (
            <p className="p-6 text-muted-foreground text-sm">Nenhum destinatário.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {targets.slice(0, MAX_ROWS).map((t) => {
                const ti = statusInfo(TARGET_STATUS, t.status);
                const when = formatDateTime(t.sent_at);
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <div className="min-w-0">
                      <span className="truncate text-sm">{t.name ?? "Sem nome"}</span>
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                        {t.phone}
                      </span>
                      {t.error && <p className="text-destructive text-[11px]">{t.error}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      {when && (
                        <span className="font-mono text-[10px] text-muted-foreground">{when}</span>
                      )}
                      <Badge variant={ti.variant}>{ti.label}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {targets.length > MAX_ROWS && (
            <p className="border-t border-border/60 p-3 text-center text-muted-foreground text-xs">
              Mostrando os primeiros {MAX_ROWS} de {targets.length} destinatários.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
