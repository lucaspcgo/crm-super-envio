import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";

export type Broadcast = Database["public"]["Tables"]["broadcasts"]["Row"];
export type BroadcastTarget = Database["public"]["Tables"]["broadcast_targets"]["Row"];

export async function getBroadcasts(orgId: string): Promise<Broadcast[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getBroadcast(orgId: string, id: string): Promise<Broadcast | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getBroadcastTargets(
  orgId: string,
  broadcastId: string,
): Promise<BroadcastTarget[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("broadcast_targets")
    .select("*")
    .eq("organization_id", orgId)
    .eq("broadcast_id", broadcastId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export type EvolutionChannel = { id: string; name: string; status: string };

/** Instâncias WhatsApp Evolution da org (pra escolher/rotacionar no disparo). */
export async function getEvolutionChannels(orgId: string): Promise<EvolutionChannel[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("channels")
    .select("id, name, status")
    .eq("organization_id", orgId)
    .eq("type", "whatsapp_evolution")
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export type ResolvedContact = { id: string; name: string; phone: string };

/**
 * Resolve os contatos-alvo do disparo. `all` = todos com telefone; `tag` =
 * contatos ligados a qualquer uma das tags escolhidas. Retorna telefone bruto
 * (a normalização/filtro final é feita na action antes de gravar os targets).
 */
export async function resolveTargetContacts(
  orgId: string,
  contactMode: "all" | "tag",
  tagIds: string[],
): Promise<ResolvedContact[]> {
  const supabase = await createClient();

  let contactIds: string[] | null = null;
  if (contactMode === "tag") {
    if (tagIds.length === 0) return [];
    const { data: links, error: linkErr } = await supabase
      .from("contact_tag_links")
      .select("contact_id")
      .eq("organization_id", orgId)
      .in("tag_id", tagIds);
    if (linkErr) throw linkErr;
    contactIds = [...new Set((links ?? []).map((l) => l.contact_id))];
    if (contactIds.length === 0) return [];
  }

  let query = supabase
    .from("contacts")
    .select("id, name, phone")
    .eq("organization_id", orgId)
    .not("phone", "is", null)
    .neq("phone", "");
  if (contactIds) query = query.in("id", contactIds);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? [])
    .filter((c): c is { id: string; name: string; phone: string } => typeof c.phone === "string")
    .map((c) => ({ id: c.id, name: c.name, phone: c.phone }));
}
