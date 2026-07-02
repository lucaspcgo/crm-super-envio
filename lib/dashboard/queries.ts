import { createClient } from "@/lib/supabase/server";

/**
 * Dados REAIS do dashboard (KPIs + gráfico), escopados por organização.
 *
 * Substitui os mocks antigos de `lib/mock/dashboard.ts`. Roda algumas
 * consultas em paralelo e monta os 4 cartões de KPI + a série do gráfico
 * (negócios criados por dia nos últimos 30 dias).
 */

export type KpiDelta = { direction: "up" | "down"; value: string };

export type Kpi = {
  label: string;
  value: string;
  /** Comparação vs. período anterior. Ausente em KPIs que são "foto do agora". */
  delta?: KpiDelta;
  /** Mini-gráfico de tendência (atividade diária dos últimos 30 dias). */
  spark?: number[];
};

export type ChartPoint = { date: string; valor: number };

export type DashboardStats = { kpis: Kpi[]; chart: ChartPoint[] };

const DAYS = 30;

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("pt-BR");

/** Só a parte da data (YYYY-MM-DD) de um timestamp/date do Postgres. */
function dayKey(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/** Comparação percentual honesta; "novo" quando não havia base pra comparar. */
function pctDelta(current: number, previous: number): KpiDelta | undefined {
  if (previous === 0) {
    if (current === 0) return undefined;
    return { direction: "up", value: "novo" };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  return { direction: pct >= 0 ? "up" : "down", value: `${pct >= 0 ? "+" : ""}${pct}%` };
}

export async function getDashboardStats(orgId: string): Promise<DashboardStats> {
  const supabase = await createClient();

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const firstOfMonthKey = firstOfMonth.toISOString().slice(0, 10);
  const firstOfLastMonthKey = firstOfLastMonth.toISOString().slice(0, 10);

  // Janela de 30 dias (para sparklines + gráfico): últimos 30 dias, cravando meia-noite.
  const windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);
  windowStart.setDate(windowStart.getDate() - (DAYS - 1));
  const windowStartIso = windowStart.toISOString();

  // Lista fixa de 30 dias (YYYY-MM-DD) para preencher buckets vazios com zero.
  const days: string[] = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(windowStart);
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }

  const [openRes, wonRes, contactsRes, tasksRes, dealsCreatedRes] = await Promise.all([
    // 1. Valor em pipeline: soma dos negócios abertos (fora de ganho/perdido).
    supabase
      .from("deals")
      .select("value")
      .eq("organization_id", orgId)
      .not("stage", "in", "(won,lost)"),
    // 2. Negócios ganhos desde o começo do mês passado (cobre mês atual + comparação + spark 30d).
    supabase
      .from("deals")
      .select("value, actual_close_date")
      .eq("organization_id", orgId)
      .eq("stage", "won")
      .gte("actual_close_date", firstOfLastMonthKey),
    // 3. Contatos criados desde o começo do mês passado.
    supabase
      .from("contacts")
      .select("created_at")
      .eq("organization_id", orgId)
      .gte("created_at", firstOfLastMonth.toISOString()),
    // 4. Todas as tarefas (status + criação) — pendentes é foto do agora, não filtra por data.
    supabase.from("tasks").select("status, created_at").eq("organization_id", orgId),
    // 5. Negócios criados nos últimos 30 dias (gráfico grande + spark do pipeline).
    supabase
      .from("deals")
      .select("created_at")
      .eq("organization_id", orgId)
      .gte("created_at", windowStartIso),
  ]);

  for (const res of [openRes, wonRes, contactsRes, tasksRes, dealsCreatedRes]) {
    if (res.error) throw res.error;
  }

  // Helpers de bucket sobre a janela de 30 dias.
  const countByDay = (dates: (string | null)[]): number[] => {
    const map = new Map(days.map((d) => [d, 0]));
    for (const iso of dates) {
      const key = dayKey(iso);
      if (key && map.has(key)) map.set(key, (map.get(key) ?? 0) + 1);
    }
    return days.map((d) => map.get(d) ?? 0);
  };
  const sumByDay = (rows: { date: string | null; value: number | null }[]): number[] => {
    const map = new Map(days.map((d) => [d, 0]));
    for (const r of rows) {
      const key = dayKey(r.date);
      if (key && map.has(key)) map.set(key, (map.get(key) ?? 0) + (r.value ?? 0));
    }
    return days.map((d) => map.get(d) ?? 0);
  };

  // --- KPI: Valor em pipeline (foto do agora) ---
  const pipelineValue = (openRes.data ?? []).reduce((acc, r) => acc + (r.value ?? 0), 0);

  // --- KPI: Ganhos no mês (com comparação mês a mês) ---
  const wonRows = wonRes.data ?? [];
  let wonThisMonth = 0;
  let wonLastMonth = 0;
  for (const r of wonRows) {
    const key = dayKey(r.actual_close_date);
    if (!key) continue;
    if (key >= firstOfMonthKey) wonThisMonth += r.value ?? 0;
    else if (key >= firstOfLastMonthKey) wonLastMonth += r.value ?? 0;
  }
  const wonSpark = sumByDay(wonRows.map((r) => ({ date: r.actual_close_date, value: r.value })));

  // --- KPI: Contatos novos no mês (com comparação mês a mês) ---
  const contactRows = contactsRes.data ?? [];
  let contactsThisMonth = 0;
  let contactsLastMonth = 0;
  for (const r of contactRows) {
    const key = dayKey(r.created_at);
    if (!key) continue;
    if (key >= firstOfMonthKey) contactsThisMonth += 1;
    else if (key >= firstOfLastMonthKey) contactsLastMonth += 1;
  }
  const contactsSpark = countByDay(contactRows.map((r) => r.created_at));

  // --- KPI: Tarefas pendentes (foto do agora) ---
  const taskRows = tasksRes.data ?? [];
  const tasksPending = taskRows.filter((t) => t.status !== "done").length;
  const tasksSpark = countByDay(taskRows.map((t) => t.created_at));

  // --- Gráfico + spark do pipeline: negócios criados por dia (30d) ---
  const dealsPerDay = countByDay((dealsCreatedRes.data ?? []).map((d) => d.created_at));
  const chart: ChartPoint[] = days.map((date, i) => ({ date, valor: dealsPerDay[i] ?? 0 }));

  const kpis: Kpi[] = [
    { label: "Valor em pipeline", value: brl.format(pipelineValue), spark: dealsPerDay },
    {
      label: "Ganhos no mês",
      value: brl.format(wonThisMonth),
      delta: pctDelta(wonThisMonth, wonLastMonth),
      spark: wonSpark,
    },
    {
      label: "Contatos novos no mês",
      value: num.format(contactsThisMonth),
      delta: pctDelta(contactsThisMonth, contactsLastMonth),
      spark: contactsSpark,
    },
    { label: "Tarefas pendentes", value: num.format(tasksPending), spark: tasksSpark },
  ];

  return { kpis, chart };
}
