import "server-only";
import { interpolate } from "@/lib/automations/templating";
import { logError } from "@/lib/logger";
import { evolutionAdapter } from "@/lib/messaging/adapters/whatsapp-evolution";
import type { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/supabase";
import type { Broadcast } from "./queries";

type Admin = ReturnType<typeof createServiceClient>;

/** Só dígitos — Evolution espera o número sem +, espaços ou traços. */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Interpola {{nome}}, {{primeiro_nome}}, {{telefone}} no corpo da mensagem. */
export function interpolateBody(body: string, target: { name: string | null; phone: string }): string {
  const name = target.name ?? "";
  const ctx = {
    nome: name,
    primeiro_nome: name.trim().split(/\s+/)[0] ?? "",
    telefone: target.phone,
  };
  const out = interpolate(body, ctx);
  return typeof out === "string" ? out : body;
}

function startOfTodayUtcIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export type PickedChannel = { id: string; config: Json };

/**
 * Escolhe a instância pro próximo envio, respeitando o limite diário por
 * instância/número. `rotate` alterna o ponto de partida por `sent_count`
 * (round-robin). Retorna null se todas as instâncias já bateram o limite hoje.
 */
export async function pickChannelForBroadcast(
  admin: Admin,
  broadcast: Broadcast,
): Promise<PickedChannel | null> {
  const ids = broadcast.instance_channel_ids;
  const n = ids.length;
  if (n === 0) return null;

  const ordered: string[] =
    broadcast.instance_mode === "rotate"
      ? // biome-ignore lint/style/noNonNullAssertion: índice sempre dentro do range
        Array.from({ length: n }, (_, i) => ids[(broadcast.sent_count + i) % n]!)
      : // biome-ignore lint/style/noNonNullAssertion: n >= 1 garantido acima
        [ids[0]!];

  const todayStart = startOfTodayUtcIso();

  for (const channelId of ordered) {
    const { count, error: countErr } = await admin
      .from("broadcast_targets")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", channelId)
      .eq("status", "sent")
      .gte("sent_at", todayStart);
    if (countErr) {
      logError("broadcasts.pickChannel.count", countErr);
      continue;
    }
    if ((count ?? 0) >= broadcast.daily_limit_per_instance) continue;

    const { data: ch, error: chErr } = await admin
      .from("channels")
      .select("id, config, type, status")
      .eq("id", channelId)
      .eq("organization_id", broadcast.organization_id)
      .maybeSingle();
    if (chErr) {
      logError("broadcasts.pickChannel.channel", chErr);
      continue;
    }
    if (ch && ch.type === "whatsapp_evolution" && ch.status === "connected") {
      return { id: ch.id, config: ch.config };
    }
  }

  return null;
}

/** Envia via adapter Evolution. Não grava DB — quem grava é o worker. */
export async function sendViaChannel(
  channelConfig: Json,
  to: string,
  body: string,
): Promise<{ ok: true; externalId: string } | { ok: false; error: string }> {
  try {
    const res = await evolutionAdapter.sendMessage(channelConfig, { to, body });
    return { ok: true, externalId: res.externalId };
  } catch (err) {
    logError("broadcasts.sendViaChannel", err);
    return { ok: false, error: "Falha no envio pela instância. Verifique se ela está conectada." };
  }
}
