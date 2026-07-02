import "server-only";
import { logError } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/service";

const STALE_MS = 5 * 60 * 1000;

/**
 * Destinatários presos em 'sending' há > 5min (worker morreu no meio do envio)
 * voltam pra 'queued' pra serem reprocessados. Espelha lib/messaging/recovery.
 */
export async function recoverStaleBroadcastTargets(): Promise<void> {
  const admin = createServiceClient();
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const { error } = await admin
    .from("broadcast_targets")
    .update({ status: "queued", sending_started_at: null, channel_id: null })
    .eq("status", "sending")
    .lt("sending_started_at", cutoff);
  if (error) logError("broadcasts.recovery", error);
}
