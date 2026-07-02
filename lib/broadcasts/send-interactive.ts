import "server-only";
import { logError } from "@/lib/logger";
import { postJson } from "@/lib/messaging/adapters/whatsapp-evolution/client";
import { stripPlus } from "@/lib/messaging/adapters/whatsapp-evolution/extract-message";
import { evolutionConfigSchema } from "@/lib/messaging/adapters/whatsapp-evolution/schema";
import type { Json } from "@/types/supabase";

export type ReplyButton = { label: string; id: string };

export type InteractiveConfig = {
  type: "reply";
  title: string;
  body: string;
  footer: string;
  buttons: ReplyButton[];
};

/** Lê a config interativa do JSONB do banco (só valida o formato de reply). */
export function parseInteractive(raw: Json): InteractiveConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.type !== "reply") return null;
  if (typeof o.body !== "string" || !Array.isArray(o.buttons)) return null;

  const buttons: ReplyButton[] = [];
  for (const b of o.buttons) {
    if (b && typeof b === "object") {
      const bb = b as Record<string, unknown>;
      if (typeof bb.label === "string" && bb.label.trim()) {
        buttons.push({ label: bb.label, id: typeof bb.id === "string" ? bb.id : bb.label });
      }
    }
  }
  if (buttons.length === 0) return null;

  return {
    type: "reply",
    title: typeof o.title === "string" ? o.title : "",
    body: o.body,
    footer: typeof o.footer === "string" ? o.footer : "",
    buttons,
  };
}

/**
 * Envia botões de resposta (Reply) via Evolution. Endpoint depende de uma
 * versão recente da Evolution (2.4.0-rc2+) e o WhatsApp restringe botões na API
 * não-oficial — pode não renderizar. Por isso a mensagem de erro é específica.
 */
export async function sendReplyButtons(
  channelConfig: Json,
  to: string,
  cfg: InteractiveConfig,
): Promise<{ ok: true; externalId: string } | { ok: false; error: string }> {
  try {
    const evo = evolutionConfigSchema.parse(channelConfig);
    const res = await postJson<{ key: { id: string } }>(
      `${evo.baseUrl}/message/sendButtons/${evo.instanceName}`,
      evo.apiKey,
      {
        number: stripPlus(to),
        title: cfg.title,
        description: cfg.body,
        footer: cfg.footer,
        buttons: cfg.buttons.map((b) => ({ type: "reply", displayText: b.label, id: b.id })),
      },
    );
    return { ok: true, externalId: res.key.id };
  } catch (err) {
    logError("broadcasts.sendReplyButtons", err);
    const msg = err instanceof Error ? err.message : "";
    if (msg && /bad request|not found|payload|unsupported|invalid/i.test(msg)) {
      return {
        ok: false,
        error:
          "Sua Evolution pode não suportar botões (precisa 2.4.0-rc2+), ou o número é inválido.",
      };
    }
    return { ok: false, error: msg || "Falha ao enviar mensagem interativa." };
  }
}
