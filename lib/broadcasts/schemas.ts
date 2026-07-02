import { z } from "zod";

/**
 * Input do disparo em massa (Fase 1). Números usam coerce porque vêm como
 * string dos inputs `type="number"` do formulário.
 */
export const createBroadcastSchema = z
  .object({
    orgSlug: z.string(),
    name: z.string().min(2, "Dê um nome pro disparo").max(120, "Nome muito longo"),
    messageBody: z.string().min(1, "Escreva a mensagem").max(4096, "Mensagem muito longa"),
    contactMode: z.enum(["all", "tag", "manual"]),
    tagIds: z.array(z.string().uuid()),
    manualNumbers: z.string().max(20000),
    instanceMode: z.enum(["specific", "rotate"]),
    channelIds: z.array(z.string().uuid()).min(1, "Escolha ao menos uma instância"),
    delayMin: z.number().int().min(1, "Mínimo 1 segundo").max(3600),
    delayMax: z.number().int().min(1).max(3600),
    dailyLimit: z.number().int().min(1).max(100000),
  })
  .refine((v) => v.delayMax >= v.delayMin, {
    message: "O delay máximo precisa ser maior ou igual ao mínimo",
    path: ["delayMax"],
  })
  .refine((v) => v.contactMode !== "tag" || v.tagIds.length > 0, {
    message: "Escolha ao menos uma tag",
    path: ["tagIds"],
  })
  .refine((v) => v.contactMode !== "manual" || v.manualNumbers.trim().length > 0, {
    message: "Cole ao menos um número",
    path: ["manualNumbers"],
  });

export type CreateBroadcastInput = z.infer<typeof createBroadcastSchema>;

export const broadcastControlSchema = z.object({
  orgSlug: z.string(),
  id: z.string().uuid(),
});

export type BroadcastControlInput = z.infer<typeof broadcastControlSchema>;
