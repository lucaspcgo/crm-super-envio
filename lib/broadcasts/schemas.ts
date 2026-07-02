import { z } from "zod";

/**
 * Input do disparo em massa. Números usam `valueAsNumber` no form (não coerce,
 * que quebra a tipagem do useForm).
 */
export const createBroadcastSchema = z
  .object({
    orgSlug: z.string(),
    name: z.string().min(2, "Dê um nome pro disparo").max(120, "Nome muito longo"),
    messageType: z.enum(["text", "media", "interactive"]),
    // Texto da mensagem OU legenda da mídia (opcional em mídia).
    messageBody: z.string().max(4096, "Mensagem muito longa"),
    mediaType: z.enum(["image", "video", "audio", "document"]).nullable(),
    mediaPath: z.string().nullable(),
    mediaMime: z.string().nullable(),
    // Interativa (POC: só reply/botões).
    interactiveType: z.enum(["reply"]).nullable(),
    interactiveTitle: z.string().max(200),
    interactiveBody: z.string().max(1024),
    interactiveFooter: z.string().max(200),
    interactiveButtons: z
      .array(z.object({ label: z.string().max(60), id: z.string().max(60) }))
      .max(3),
    randomEmojiSuffix: z.boolean(),
    contactMode: z.enum(["all", "tag", "manual"]),
    tagIds: z.array(z.string().uuid()),
    manualNumbers: z.string().max(20000),
    instanceMode: z.enum(["specific", "rotate"]),
    channelIds: z.array(z.string().uuid()).min(1, "Escolha ao menos uma instância"),
    delayMin: z.number().int().min(1, "Mínimo 1 segundo").max(3600),
    delayMax: z.number().int().min(1).max(3600),
    dailyLimit: z.number().int().min(1).max(100000),
    pauseMinutes: z.number().int().min(0).max(1440),
    batchSize: z.number().int().min(1).max(100000),
  })
  .refine((v) => v.messageType !== "text" || v.messageBody.trim().length > 0, {
    message: "Escreva a mensagem",
    path: ["messageBody"],
  })
  .refine((v) => v.messageType !== "media" || (!!v.mediaPath && !!v.mediaType), {
    message: "Escolha um arquivo de mídia",
    path: ["mediaPath"],
  })
  .refine((v) => v.messageType !== "interactive" || v.interactiveBody.trim().length > 0, {
    message: "Escreva o texto da mensagem",
    path: ["interactiveBody"],
  })
  .refine(
    (v) => v.messageType !== "interactive" || v.interactiveButtons.some((b) => b.label.trim()),
    { message: "Adicione ao menos um botão com texto", path: ["interactiveButtons"] },
  )
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

export const uploadBroadcastMediaSchema = z.object({
  orgSlug: z.string(),
  fileBase64: z.string().min(1),
  mimeType: z.string().min(1).max(200),
  filename: z.string().min(1).max(300),
});

export type UploadBroadcastMediaInput = z.infer<typeof uploadBroadcastMediaSchema>;

export const broadcastControlSchema = z.object({
  orgSlug: z.string(),
  id: z.string().uuid(),
});

export type BroadcastControlInput = z.infer<typeof broadcastControlSchema>;
