"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOrgRole } from "@/lib/auth/guards";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/supabase";
import { resolveTargetContacts } from "./queries";
import {
  type CreateBroadcastInput,
  createBroadcastSchema,
  type UploadBroadcastMediaInput,
  uploadBroadcastMediaSchema,
} from "./schemas";
import { normalizePhone } from "./send";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const MEDIA_BUCKET = "broadcast-media";

/**
 * Sobe o arquivo de mídia pro storage (bucket privado) e devolve o caminho.
 * O envio real gera uma signed URL curta a cada disparo (o worker), então aqui
 * só guardamos o `path`. Usa service role — a action já é protegida por role.
 */
export async function uploadBroadcastMediaAction(
  input: UploadBroadcastMediaInput,
): Promise<{ ok: true; data: { path: string } } | { ok: false; error: string }> {
  const parsed = uploadBroadcastMediaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos" };

  const { org } = await requireOrgRole({ orgSlug: parsed.data.orgSlug, roles: ["owner", "admin"] });

  const buf = Buffer.from(parsed.data.fileBase64, "base64");
  if (buf.length === 0) return { ok: false, error: "Arquivo vazio." };
  if (buf.length > 25 * 1024 * 1024)
    return { ok: false, error: "Arquivo muito grande (máx 25MB)." };

  const ext = (parsed.data.filename.split(".").pop() ?? "bin")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const path = `${org.id}/${randomUUID()}.${ext || "bin"}`;

  const admin = createServiceClient();
  const { error } = await admin.storage
    .from(MEDIA_BUCKET)
    .upload(path, buf, { contentType: parsed.data.mimeType, upsert: false });
  if (error) {
    logError("broadcasts.uploadMedia", error);
    return { ok: false, error: "Não foi possível enviar o arquivo. Tente novamente." };
  }

  return { ok: true, data: { path } };
}

export async function createBroadcastAction(
  input: CreateBroadcastInput,
): Promise<{ ok: true; data: { broadcastId: string } } | { ok: false; error: string }> {
  const parsed = createBroadcastSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { user, org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });
  const supabase = await createClient();

  // Valida que as instâncias pertencem à org, são Evolution e estão conectadas.
  const { data: channels, error: chErr } = await supabase
    .from("channels")
    .select("id, type, status")
    .eq("organization_id", org.id)
    .in("id", parsed.data.channelIds);
  if (chErr) {
    logError("broadcasts.create.channels", chErr);
    return { ok: false, error: "Erro ao validar as instâncias. Tente novamente." };
  }
  const evolution = (channels ?? []).filter((c) => c.type === "whatsapp_evolution");
  if (evolution.length !== parsed.data.channelIds.length) {
    return { ok: false, error: "Escolha apenas instâncias WhatsApp válidas." };
  }
  const connectedIds = evolution.filter((c) => c.status === "connected").map((c) => c.id);
  if (connectedIds.length === 0) {
    return { ok: false, error: "Nenhuma instância escolhida está conectada." };
  }

  // Mídia: o arquivo precisa pertencer a esta org (path começa com o org.id).
  if (parsed.data.messageType === "media" && !parsed.data.mediaPath?.startsWith(`${org.id}/`)) {
    return { ok: false, error: "Arquivo de mídia inválido. Envie o arquivo de novo." };
  }

  // Monta os destinatários (dedupe por número já normalizado).
  const seen = new Set<string>();
  const targets: { contact_id: string | null; phone: string; name: string | null }[] = [];

  if (parsed.data.contactMode === "manual") {
    // Números colados à mão (um por linha / separados por vírgula/espaço).
    for (const raw of parsed.data.manualNumbers.split(/[\s,;]+/)) {
      const phone = normalizePhone(raw);
      if (phone.length < 8 || seen.has(phone)) continue;
      seen.add(phone);
      targets.push({ contact_id: null, phone, name: null });
    }
  } else {
    let contacts: Awaited<ReturnType<typeof resolveTargetContacts>>;
    try {
      contacts = await resolveTargetContacts(org.id, parsed.data.contactMode, parsed.data.tagIds);
    } catch (err) {
      logError("broadcasts.create.resolve", err);
      return { ok: false, error: "Erro ao buscar os contatos. Tente novamente." };
    }
    for (const c of contacts) {
      const phone = normalizePhone(c.phone);
      if (phone.length < 8 || seen.has(phone)) continue;
      seen.add(phone);
      targets.push({ contact_id: c.id, phone, name: c.name });
    }
  }

  if (targets.length === 0) {
    return {
      ok: false,
      error:
        parsed.data.contactMode === "manual"
          ? "Nenhum número válido na lista."
          : "Nenhum contato com telefone válido pra esse filtro.",
    };
  }

  // Monta a config interativa (POC: reply/botões) quando for o caso.
  const interactive =
    parsed.data.messageType === "interactive"
      ? {
          type: "reply",
          title: parsed.data.interactiveTitle,
          body: parsed.data.interactiveBody,
          footer: parsed.data.interactiveFooter,
          buttons: parsed.data.interactiveButtons
            .filter((b) => b.label.trim())
            .slice(0, 3)
            .map((b, i) => ({
              label: b.label.trim(),
              id: (b.id.trim() || `opt_${i + 1}`).slice(0, 60),
            })),
        }
      : null;

  // Cria o disparo (já em andamento) e enfileira os destinatários.
  const nowIso = new Date().toISOString();
  const { data: broadcast, error: bErr } = await supabase
    .from("broadcasts")
    .insert({
      organization_id: org.id,
      created_by: user.id,
      name: parsed.data.name,
      message_type: parsed.data.messageType,
      message_body: parsed.data.messageBody,
      media_type: parsed.data.messageType === "media" ? parsed.data.mediaType : null,
      media_path: parsed.data.messageType === "media" ? parsed.data.mediaPath : null,
      media_mime: parsed.data.messageType === "media" ? parsed.data.mediaMime : null,
      interactive,
      instance_mode: parsed.data.instanceMode,
      instance_channel_ids: connectedIds,
      delay_min_seconds: parsed.data.delayMin,
      delay_max_seconds: parsed.data.delayMax,
      daily_limit_per_instance: parsed.data.dailyLimit,
      pause_minutes: parsed.data.pauseMinutes,
      batch_size: parsed.data.batchSize,
      random_emoji_suffix: parsed.data.randomEmojiSuffix,
      status: "running",
      total_targets: targets.length,
      started_at: nowIso,
      next_send_at: nowIso,
    })
    .select("id")
    .single();
  if (bErr || !broadcast) {
    logError("broadcasts.create.insert", bErr);
    return { ok: false, error: "Erro ao criar o disparo. Tente novamente." };
  }

  const rows = targets.map((t) => ({
    organization_id: org.id,
    broadcast_id: broadcast.id,
    contact_id: t.contact_id,
    phone: t.phone,
    name: t.name,
    status: "queued" as const,
  }));
  const { error: tErr } = await supabase.from("broadcast_targets").insert(rows);
  if (tErr) {
    logError("broadcasts.create.targets", tErr);
    // Rollback: apaga o disparo (cascade remove targets já inseridos).
    await supabase.from("broadcasts").delete().eq("id", broadcast.id);
    return { ok: false, error: "Erro ao preparar os destinatários. Tente novamente." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/disparador`);
  return { ok: true, data: { broadcastId: broadcast.id } };
}

async function transition(
  orgSlug: string,
  id: string,
  fromStatuses: string[],
  patch: Database["public"]["Tables"]["broadcasts"]["Update"],
  notInStateMsg: string,
): Promise<Result> {
  const { org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", org.id)
    .in("status", fromStatuses)
    .select("id");
  if (error) {
    logError("broadcasts.transition", error);
    return { ok: false, error: "Não foi possível atualizar o disparo. Tente novamente." };
  }
  if (!data || data.length === 0) return { ok: false, error: notInStateMsg };
  revalidatePath(`/app/${orgSlug}/disparador`);
  revalidatePath(`/app/${orgSlug}/disparador/${id}`);
  return { ok: true };
}

export async function pauseBroadcastAction(orgSlug: string, id: string): Promise<Result> {
  return transition(
    orgSlug,
    id,
    ["running"],
    { status: "paused" },
    "O disparo não está em andamento.",
  );
}

export async function resumeBroadcastAction(orgSlug: string, id: string): Promise<Result> {
  return transition(
    orgSlug,
    id,
    ["paused"],
    { status: "running", next_send_at: new Date().toISOString() },
    "O disparo não está pausado.",
  );
}

export async function cancelBroadcastAction(orgSlug: string, id: string): Promise<Result> {
  return transition(
    orgSlug,
    id,
    ["running", "paused"],
    { status: "canceled", finished_at: new Date().toISOString(), next_send_at: null },
    "O disparo já terminou.",
  );
}
