import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgMember } from "@/lib/auth/guards";
import { getDashboardStats } from "@/lib/dashboard/queries";
import { createClient } from "@/lib/supabase/server";
import { DashboardChart } from "./dashboard-chart";
import { KpiCard } from "./kpi-card";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata = { title: "Início" };

export default async function DashboardPage({ params }: Props) {
  const { orgSlug } = await params;
  const { user, org } = await requireOrgMember({ orgSlug });

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const displayName = profile?.full_name ?? user.email ?? "";

  const { kpis, chart } = await getDashboardStats(org.id);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="label-mono">/ overview</div>
          <h1 className="font-semibold text-3xl tracking-tight">Bem-vindo, {displayName}</h1>
          <p className="text-muted-foreground text-sm">
            Workspace <span className="text-foreground/80">{org.name}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 pulse-soft" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            últimos 30 dias
          </span>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} />
        ))}
      </div>

      {/* Chart */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="flex items-center gap-2 font-medium text-sm">
            <span className="label-mono">/ negócios criados</span>
          </CardTitle>
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            últimos 30 dias
          </div>
        </CardHeader>
        <CardContent className="p-5">
          <DashboardChart data={chart} />
        </CardContent>
      </Card>
    </div>
  );
}
