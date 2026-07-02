"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { TextField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createMemberAccountAction } from "@/lib/members/actions";
import { type CreateMemberAccountInput, createMemberAccountSchema } from "@/lib/members/schemas";

export function CreateMemberDialog({ orgSlug }: { orgSlug: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const form = useForm<CreateMemberAccountInput>({
    resolver: zodResolver(createMemberAccountSchema),
    defaultValues: { orgSlug, fullName: "", email: "", password: "", role: "member" },
  });

  const isAdmin = form.watch("role") === "admin";

  function onSubmit(values: CreateMemberAccountInput) {
    startTransition(async () => {
      const result = await createMemberAccountAction(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Acesso criado! Passe o email e a senha pra pessoa entrar.");
      form.reset({ orgSlug, fullName: "", email: "", password: "", role: "member" });
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>Criar acesso</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar acesso pra alguém</DialogTitle>
        </DialogHeader>
        <FormProvider {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <TextField
              name="fullName"
              control={form.control}
              label="Nome"
              inputProps={{ placeholder: "Nome da pessoa" }}
            />
            <TextField
              name="email"
              control={form.control}
              label="Email"
              inputProps={{ type: "email", placeholder: "pessoa@exemplo.com", autoComplete: "off" }}
            />
            <TextField
              name="password"
              control={form.control}
              label="Senha"
              description="Mínimo 10 caracteres. Você vai repassar essa senha pra pessoa."
              inputProps={{ type: "text", placeholder: "senha inicial", autoComplete: "off" }}
            />
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card/40 px-3 py-2.5">
              <div className="space-y-0.5">
                <Label>Administrador</Label>
                <p className="text-muted-foreground text-xs">
                  Pode gerenciar membros e configurações do workspace.
                </p>
              </div>
              <Switch
                checked={isAdmin}
                onCheckedChange={(checked) =>
                  form.setValue("role", checked ? "admin" : "member")
                }
              />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Criando..." : "Criar acesso"}
            </Button>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
