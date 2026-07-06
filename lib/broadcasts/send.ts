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

const SUFFIX_EMOJIS = ["✅", "😊", "🙂", "👍", "✨", "🔥", "🚀", "💬", "📌", "🎯", "👋", "💡"];

/** Acrescenta um emoji aleatório no fim (anti-ban: varia cada mensagem). */
export function withRandomEmoji(body: string): string {
  const emoji = SUFFIX_EMOJIS[Math.floor(Math.random() * SUFFIX_EMOJIS.length)];
  return `${body} ${emoji}`;
}

/** Interpola {{nome}}, {{primeiro_nome}}, {{telefone}} no corpo da mensagem. */
export function interpolateBody(
  body: string,
  target: { name: string | null; phone: string },
): string {
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
      ? Array.from({ length: n }, (_, i) => ids[(broadcast.sent_count + i) % n]!)
      : [ids[0]!];

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

/** Gera uma signed URL curta pra mídia (o Evolution baixa na hora do envio). */
export async function signBroadcastMedia(admin: Admin, path: string): Promise<string | null> {
  const { data, error } = await admin.storage.from("broadcast-media").createSignedUrl(path, 300);
  if (error || !data?.signedUrl) {
    logError("broadcasts.signMedia", error);
    return null;
  }
  return data.signedUrl;
}

/** Envia via adapter Evolution. Não grava DB — quem grava é o worker. */
export async function sendViaChannel(
  channelConfig: Json,
  to: string,
  body: string,
  media?: { url: string; mimeType: string },
): Promise<{ ok: true; externalId: string } | { ok: false; error: string }> {
  try {
    const res = await evolutionAdapter.sendMessage(channelConfig, {
      to,
      body,
      ...(media ? { media: [media] } : {}),
    });
    return { ok: true, externalId: res.externalId };
  } catch (err) {
    logError("broadcasts.sendViaChannel", err);
    // O adapter já traduz os erros do Evolution (mapEvolutionError) — repassa a
    // causa real em vez de uma mensagem genérica que culpa a instância.
    const msg = err instanceof Error ? err.message : "";
    let friendly: string;
    if (!msg) {
      friendly = "Falha no envio pela instância.";
    } else if (/bad request|payload inválido/i.test(msg)) {
      // 400 genérico no envio quase sempre = número inválido / fora do WhatsApp.
      friendly = "Número inválido ou não está no WhatsApp.";
    } else {
      friendly = msg;
    }
    return { ok: false, error: friendly };
  }
}
