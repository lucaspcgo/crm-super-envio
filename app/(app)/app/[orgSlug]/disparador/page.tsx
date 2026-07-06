import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgRole } from "@/lib/auth/guards";
import { getBroadcasts } from "@/lib/broadcasts/queries";
import { BROADCAST_STATUS, statusInfo } from "./labels";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata = { title: "Disparador" };

export default async function DisparadorPage({ params }: Props) {
  const { orgSlug } = await params;
  const { org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });
  const broadcasts = await getBroadcasts(org.id);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <span className="label-mono">/ disparador</span>
          <h1 className="font-semibold text-3xl tracking-tight">Disparador em Massa</h1>
          <p className="text-muted-foreground text-sm">
            Envie mensagens para vários contatos com rotação de instâncias e proteção anti-ban.
          </p>
        </div>
        <Button render={<Link href={`/app/${orgSlug}/disparador/novo`} />} nativeButton={false}>
          Novo disparo
        </Button>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ meus disparos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {broadcasts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Nenhum disparo ainda"
                description="Crie seu primeiro disparo em massa pra enviar uma mensagem pra vários contatos."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {broadcasts.map((b) => {
                const info = statusInfo(BROADCAST_STATUS, b.status);
                const done = b.sent_count + b.failed_count;
                return (
                  <li key={b.id}>
                    <Link
                      href={`/app/${orgSlug}/disparador/${b.id}`}
                      className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-sm">{b.name}</span>
                          <Badge variant={info.variant}>{info.label}</Badge>
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {done}/{b.total_targets} enviados · {b.failed_count} falhas
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {new Date(b.created_at).toLocaleDateString("pt-BR")}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
