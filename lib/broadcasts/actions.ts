"use server";

import { revalidatePath } from "next/cache";
import { requireOrgRole } from "@/lib/auth/guards";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";
import { resolveTargetContacts } from "./queries";
import { type CreateBroadcastInput, createBroadcastSchema } from "./schemas";
import { normalizePhone } from "./send";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

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

  // Resolve contatos e normaliza telefones (dedupe por número).
  let contacts: Awaited<ReturnType<typeof resolveTargetContacts>>;
  try {
    contacts = await resolveTargetContacts(org.id, parsed.data.contactMode, parsed.data.tagIds);
  } catch (err) {
    logError("broadcasts.create.resolve", err);
    return { ok: false, error: "Erro ao buscar os contatos. Tente novamente." };
  }

  const seen = new Set<string>();
  const targets: { contact_id: string; phone: string; name: string }[] = [];
  for (const c of contacts) {
    const phone = normalizePhone(c.phone);
    if (phone.length < 8 || seen.has(phone)) continue;
    seen.add(phone);
    targets.push({ contact_id: c.id, phone, name: c.name });
  }
  if (targets.length === 0) {
    return { ok: false, error: "Nenhum contato com telefone válido pra esse filtro." };
  }

  // Cria o disparo (já em andamento) e enfileira os destinatários.
  const nowIso = new Date().toISOString();
  const { data: broadcast, error: bErr } = await supabase
    .from("broadcasts")
    .insert({
      organization_id: org.id,
      created_by: user.id,
      name: parsed.data.name,
      message_type: "text",
      message_body: parsed.data.messageBody,
      instance_mode: parsed.data.instanceMode,
      instance_channel_ids: connectedIds,
      delay_min_seconds: parsed.data.delayMin,
      delay_max_seconds: parsed.data.delayMax,
      daily_limit_per_instance: parsed.data.dailyLimit,
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
  return transition(orgSlug, id, ["running"], { status: "paused" }, "O disparo não está em andamento.");
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
