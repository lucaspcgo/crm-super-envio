import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgRole } from "@/lib/auth/guards";
import { getBroadcast, getBroadcastTargets } from "@/lib/broadcasts/queries";
import { BROADCAST_STATUS, statusInfo, TARGET_STATUS } from "../labels";
import { BroadcastControls } from "./broadcast-controls";
import { ReportRefresh } from "./report-refresh";

type Props = { params: Promise<{ orgSlug: string; id: string }> };

const MAX_ROWS = 300;

export default async function BroadcastDetailPage({ params }: Props) {
  const { orgSlug, id } = await params;
  const { org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });

  const broadcast = await getBroadcast(org.id, id);
  if (!broadcast) notFound();

  const targets = await getBroadcastTargets(org.id, id);
  const info = statusInfo(BROADCAST_STATUS, broadcast.status);
  const done = broadcast.sent_count + broadcast.failed_count;
  const pct = broadcast.total_targets > 0 ? Math.round((done / broadcast.total_targets) * 100) : 0;

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

      {/* Progresso */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ progresso</CardTitle>
          <ReportRefresh />
        </CardHeader>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-baseline justify-between">
            <span className="font-semibold text-2xl tabular-nums">
              {done}
              <span className="text-muted-foreground text-lg"> / {broadcast.total_targets}</span>
            </span>
            <span className="font-mono text-muted-foreground text-xs">{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex gap-4 font-mono text-[11px] text-muted-foreground">
            <span className="text-primary">{broadcast.sent_count} enviados</span>
            <span className="text-destructive">{broadcast.failed_count} falhas</span>
            <span>{broadcast.total_targets - done} restantes</span>
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
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <div className="min-w-0">
                      <span className="truncate text-sm">{t.name ?? "Sem nome"}</span>
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                        {t.phone}
                      </span>
                      {t.error && <p className="text-destructive text-[11px]">{t.error}</p>}
                    </div>
                    <Badge variant={ti.variant}>{ti.label}</Badge>
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
