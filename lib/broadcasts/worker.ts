import "server-only";
import { logError } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/service";
import type { Broadcast } from "./queries";
import {
  interpolateBody,
  pickChannelForBroadcast,
  sendViaChannel,
  signBroadcastMedia,
  withRandomEmoji,
} from "./send";
import { parseInteractive, sendReplyButtons } from "./send-interactive";

type Admin = ReturnType<typeof createServiceClient>;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 1 tick do worker de disparos. Pra cada disparo em `running` cujo
 * `next_send_at` já passou, envia **1** destinatário (serializa o envio →
 * respeita o delay anti-ban) e reagenda o próximo.
 */
export async function processNextBroadcastSends(): Promise<void> {
  const admin = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: running, error } = await admin
    .from("broadcasts")
    .select("*")
    .eq("status", "running")
    .or(`next_send_at.is.null,next_send_at.lte.${nowIso}`);
  if (error) {
    logError("broadcasts.worker.list", error);
    return;
  }

  for (const broadcast of running ?? []) {
    await processOneBroadcast(admin, broadcast);
  }
}

async function processOneBroadcast(admin: Admin, broadcast: Broadcast): Promise<void> {
  // Próximo destinatário na fila.
  const { data: target, error: tErr } = await admin
    .from("broadcast_targets")
    .select("*")
    .eq("broadcast_id", broadcast.id)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (tErr) {
    logError("broadcasts.worker.target", tErr);
    return;
  }

  // Fila vazia → disparo concluído.
  if (!target) {
    await admin
      .from("broadcasts")
      .update({ status: "done", finished_at: new Date().toISOString(), next_send_at: null })
      .eq("id", broadcast.id);
    return;
  }

  // Escolhe instância respeitando o limite diário.
  const channel = await pickChannelForBroadcast(admin, broadcast);
  if (!channel) {
    // Todas as instâncias bateram o limite hoje → tenta de novo em 1h.
    const retryAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await admin.from("broadcasts").update({ next_send_at: retryAt }).eq("id", broadcast.id);
    return;
  }

  // Claim otimista: só um worker roda, mas marca 'sending' pra recovery.
  const { error: claimErr } = await admin
    .from("broadcast_targets")
    .update({
      status: "sending",
      sending_started_at: new Date().toISOString(),
      channel_id: channel.id,
    })
    .eq("id", target.id)
    .eq("status", "queued");
  if (claimErr) {
    logError("broadcasts.worker.claim", claimErr);
    return;
  }

  // Interpola variáveis ({{nome}}, {{primeiro_nome}}) por destinatário.
  const interp = (s: string) => interpolateBody(s, { name: target.name, phone: target.phone });

  let result: { ok: true; externalId: string } | { ok: false; error: string };

  if (broadcast.message_type === "interactive") {
    // Mensagem interativa (POC: reply/botões).
    const cfg = parseInteractive(broadcast.interactive);
    if (!cfg) {
      result = { ok: false, error: "Configuração interativa inválida." };
    } else {
      let interpBody = interp(cfg.body);
      if (broadcast.random_emoji_suffix) interpBody = withRandomEmoji(interpBody);
      result = await sendReplyButtons(channel.config, target.phone, {
        ...cfg,
        title: interp(cfg.title),
        body: interpBody,
        footer: interp(cfg.footer),
      });
    }
  } else {
    // Texto ou mídia. Monta o corpo (variáveis + emoji opcional).
    let body = interp(broadcast.message_body);
    if (broadcast.random_emoji_suffix) body = withRandomEmoji(body);

    if (broadcast.message_type === "media" && broadcast.media_path && broadcast.media_mime) {
      const url = await signBroadcastMedia(admin, broadcast.media_path);
      result = url
        ? await sendViaChannel(channel.config, target.phone, body, {
            url,
            mimeType: broadcast.media_mime,
          })
        : { ok: false, error: "Falha ao preparar a mídia do disparo." };
    } else {
      result = await sendViaChannel(channel.config, target.phone, body);
    }
  }

  if (result.ok) {
    await admin
      .from("broadcast_targets")
      .update({
        status: "sent",
        external_id: result.externalId,
        sent_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", target.id);
  } else {
    await admin
      .from("broadcast_targets")
      .update({ status: "failed", error: result.error })
      .eq("id", target.id);
  }

  // Atualiza contadores + agenda o próximo envio.
  // Anti-ban: delay aleatório entre cada mensagem; a cada `batch_size` enviadas,
  // uma pausa maior de `pause_minutes` (0 = sem pausa por lote).
  const newSentCount = broadcast.sent_count + (result.ok ? 1 : 0);
  const hitBatchBoundary =
    result.ok && broadcast.pause_minutes > 0 && newSentCount % broadcast.batch_size === 0;
  const nextDelayMs = hitBatchBoundary
    ? broadcast.pause_minutes * 60_000
    : randomInt(broadcast.delay_min_seconds, broadcast.delay_max_seconds) * 1000;
  const nextAt = new Date(Date.now() + nextDelayMs).toISOString();
  await admin
    .from("broadcasts")
    .update({
      sent_count: newSentCount,
      failed_count: broadcast.failed_count + (result.ok ? 0 : 1),
      next_send_at: nextAt,
    })
    .eq("id", broadcast.id);
}
