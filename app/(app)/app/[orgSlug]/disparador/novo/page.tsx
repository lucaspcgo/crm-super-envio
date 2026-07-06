import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireOrgRole } from "@/lib/auth/guards";
import { getEvolutionChannels } from "@/lib/broadcasts/queries";
import { listTags } from "@/lib/tags/queries";
import { NewBroadcastForm } from "./new-broadcast-form";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata = { title: "Novo disparo" };

export default async function NovoDisparoPage({ params }: Props) {
  const { orgSlug } = await params;
  const { org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });

  const [channels, tags] = await Promise.all([getEvolutionChannels(org.id), listTags(org.id)]);
  const connected = channels
    .filter((c) => c.status === "connected")
    .map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="max-w-2xl space-y-8">
      <Button
        render={<Link href={`/app/${orgSlug}/disparador`} />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Voltar
      </Button>

      <div className="space-y-1.5">
        <span className="label-mono">/ novo disparo</span>
        <h1 className="font-semibold text-3xl tracking-tight">Novo disparo</h1>
        <p className="text-muted-foreground text-sm">
          Configure a mensagem, escolha os contatos e as instâncias.
        </p>
      </div>

      <NewBroadcastForm
        orgSlug={orgSlug}
        channels={connected}
        tags={tags.map((t) => ({ id: t.id, name: t.name }))}
      />
    </div>
  );
}
