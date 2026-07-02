"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { TextField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createBroadcastAction } from "@/lib/broadcasts/actions";
import { type CreateBroadcastInput, createBroadcastSchema } from "@/lib/broadcasts/schemas";
import { cn } from "@/lib/utils";

type NamedItem = { id: string; name: string };

type Props = {
  orgSlug: string;
  channels: NamedItem[];
  tags: NamedItem[];
};

function Pill({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-2 text-sm transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border/60 bg-card/40 text-muted-foreground hover:text-foreground",
        disabled && "cursor-not-allowed opacity-50 hover:text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function NewBroadcastForm({ orgSlug, channels, tags }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<CreateBroadcastInput>({
    resolver: zodResolver(createBroadcastSchema),
    defaultValues: {
      orgSlug,
      name: "",
      messageBody: "",
      contactMode: "all",
      tagIds: [],
      manualNumbers: "",
      instanceMode: "specific",
      channelIds: [],
      delayMin: 8,
      delayMax: 25,
      pauseMinutes: 5,
      batchSize: 50,
      dailyLimit: 800,
    },
  });

  const contactMode = form.watch("contactMode");
  const tagIds = form.watch("tagIds");
  const instanceMode = form.watch("instanceMode");
  const channelIds = form.watch("channelIds");
  const errors = form.formState.errors;

  function toggleTag(id: string) {
    const next = tagIds.includes(id) ? tagIds.filter((t) => t !== id) : [...tagIds, id];
    form.setValue("tagIds", next, { shouldValidate: true });
  }

  function pickInstance(id: string) {
    if (instanceMode === "specific") {
      form.setValue("channelIds", [id], { shouldValidate: true });
    } else {
      const next = channelIds.includes(id)
        ? channelIds.filter((c) => c !== id)
        : [...channelIds, id];
      form.setValue("channelIds", next, { shouldValidate: true });
    }
  }

  function setInstanceMode(mode: "specific" | "rotate") {
    form.setValue("instanceMode", mode);
    form.setValue("channelIds", [], { shouldValidate: true });
  }

  function onSubmit(values: CreateBroadcastInput) {
    startTransition(async () => {
      const result = await createBroadcastAction(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Disparo iniciado! Acompanhe o progresso abaixo.");
      router.push(`/app/${orgSlug}/disparador/${result.data.broadcastId}`);
    });
  }

  const noChannels = channels.length === 0;

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* 1. Mensagem */}
        <Card>
          <CardHeader className="border-b border-border/60 bg-card/40 py-3">
            <CardTitle className="label-mono text-[10px]">/ mensagem</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <div className="flex gap-2">
              <Pill active>Texto</Pill>
              <Pill active={false} disabled>
                Mídia (em breve)
              </Pill>
              <Pill active={false} disabled>
                Interativa (em breve)
              </Pill>
            </div>

            <TextField
              name="name"
              control={form.control}
              label="Nome do disparo"
              inputProps={{ placeholder: "Ex: Promoção de julho" }}
            />

            <div className="space-y-1.5">
              <label htmlFor="messageBody" className="font-medium text-sm">
                Texto da mensagem
              </label>
              <Textarea
                id="messageBody"
                rows={5}
                placeholder="Oi {{primeiro_nome}}, tudo bem? ..."
                {...form.register("messageBody")}
              />
              <p className="text-muted-foreground text-xs">
                Variáveis: <code className="font-mono">{"{{nome}}"}</code>,{" "}
                <code className="font-mono">{"{{primeiro_nome}}"}</code>. Personalizar evita
                mensagens idênticas (reduz risco de ban).
              </p>
              {errors.messageBody && (
                <p className="text-destructive text-xs">{errors.messageBody.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 2. Contatos */}
        <Card>
          <CardHeader className="border-b border-border/60 bg-card/40 py-3">
            <CardTitle className="label-mono text-[10px]">/ contatos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap gap-2">
              <Pill
                active={contactMode === "all"}
                onClick={() => form.setValue("contactMode", "all", { shouldValidate: true })}
              >
                Todos os contatos
              </Pill>
              <Pill
                active={contactMode === "tag"}
                onClick={() => form.setValue("contactMode", "tag", { shouldValidate: true })}
              >
                Por tag
              </Pill>
              <Pill
                active={contactMode === "manual"}
                onClick={() => form.setValue("contactMode", "manual", { shouldValidate: true })}
              >
                Números avulsos
              </Pill>
            </div>

            {contactMode === "all" && (
              <p className="text-muted-foreground text-sm">
                Vai enviar pra todos os contatos que têm telefone cadastrado.
              </p>
            )}

            {contactMode === "tag" &&
              (tags.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Você ainda não tem tags. Crie tags nos contatos pra segmentar.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((t) => {
                      const selected = tagIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleTag(t.id)}
                          className={cn(
                            "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                            selected
                              ? "border-primary bg-primary/10"
                              : "border-border/60 bg-card/40",
                          )}
                        >
                          <span
                            className={cn(
                              "grid size-4 place-items-center rounded-[4px] border",
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-input",
                            )}
                          >
                            {selected && <CheckIcon className="size-3" />}
                          </span>
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                  {errors.tagIds && (
                    <p className="text-destructive text-xs">{errors.tagIds.message}</p>
                  )}
                </>
              ))}

            {contactMode === "manual" && (
              <div className="space-y-1.5">
                <Textarea
                  rows={4}
                  placeholder={"Um número por linha:\n5562999999999\n5511988887777"}
                  {...form.register("manualNumbers")}
                />
                <p className="text-muted-foreground text-xs">
                  Um número por linha (ou separados por vírgula). Use DDI + DDD, ex:{" "}
                  <code className="font-mono">5562999999999</code>.
                </p>
                {errors.manualNumbers && (
                  <p className="text-destructive text-xs">{errors.manualNumbers.message}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3. Instâncias & Anti-ban */}
        <Card>
          <CardHeader className="border-b border-border/60 bg-card/40 py-3">
            <CardTitle className="label-mono text-[10px]">/ instâncias & anti-ban</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {noChannels ? (
              <p className="text-destructive text-sm">
                Nenhuma instância WhatsApp Evolution conectada. Conecte um canal em Configurações →
                Canais antes de disparar.
              </p>
            ) : (
              <>
                <div className="flex gap-2">
                  <Pill
                    active={instanceMode === "specific"}
                    onClick={() => setInstanceMode("specific")}
                  >
                    Uma instância
                  </Pill>
                  <Pill
                    active={instanceMode === "rotate"}
                    onClick={() => setInstanceMode("rotate")}
                  >
                    Rotacionar
                  </Pill>
                </div>

                <div className="space-y-2">
                  <p className="text-muted-foreground text-xs">
                    {instanceMode === "specific"
                      ? "Escolha 1 instância pra disparar."
                      : "Marque as instâncias que vão se revezar no envio."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {channels.map((c) => (
                      <Pill
                        key={c.id}
                        active={channelIds.includes(c.id)}
                        onClick={() => pickInstance(c.id)}
                      >
                        {c.name}
                      </Pill>
                    ))}
                  </div>
                  {errors.channelIds && (
                    <p className="text-destructive text-xs">{errors.channelIds.message}</p>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor="delayMin" className="font-medium text-sm">
                      Delay min (seg)
                    </label>
                    <Input
                      id="delayMin"
                      type="number"
                      min={1}
                      {...form.register("delayMin", { valueAsNumber: true })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="delayMax" className="font-medium text-sm">
                      Delay max (seg)
                    </label>
                    <Input
                      id="delayMax"
                      type="number"
                      min={1}
                      {...form.register("delayMax", { valueAsNumber: true })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="pauseMinutes" className="font-medium text-sm">
                      Pausa (min)
                    </label>
                    <Input
                      id="pauseMinutes"
                      type="number"
                      min={0}
                      {...form.register("pauseMinutes", { valueAsNumber: true })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="batchSize" className="font-medium text-sm">
                      Tamanho do lote
                    </label>
                    <Input
                      id="batchSize"
                      type="number"
                      min={1}
                      {...form.register("batchSize", { valueAsNumber: true })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="dailyLimit" className="font-medium text-sm">
                      Limite/dia por nº
                    </label>
                    <Input
                      id="dailyLimit"
                      type="number"
                      min={1}
                      {...form.register("dailyLimit", { valueAsNumber: true })}
                    />
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">
                  A cada <strong>{form.watch("batchSize") || 0}</strong> mensagens, o disparo pausa
                  por <strong>{form.watch("pauseMinutes") || 0}</strong> min (coloque 0 na pausa pra
                  desligar).
                </p>
                {(errors.delayMin ||
                  errors.delayMax ||
                  errors.pauseMinutes ||
                  errors.batchSize ||
                  errors.dailyLimit) && (
                  <p className="text-destructive text-xs">
                    {errors.delayMin?.message ??
                      errors.delayMax?.message ??
                      errors.pauseMinutes?.message ??
                      errors.batchSize?.message ??
                      errors.dailyLimit?.message}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Aviso + submit */}
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-muted-foreground">
            Disparo em massa por API não-oficial tem risco de <strong>ban do número</strong>. Use
            delays, personalize a mensagem e teste primeiro na sua instância de teste com poucos
            números.
          </p>
        </div>

        <Button type="submit" className="w-full" disabled={pending || noChannels}>
          {pending ? "Iniciando..." : "Iniciar Disparo"}
        </Button>
      </form>
    </FormProvider>
  );
}
