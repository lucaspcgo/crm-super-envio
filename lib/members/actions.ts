"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrgMember, requireOrgRole } from "@/lib/auth/guards";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  type ChangeRoleInput,
  changeRoleSchema,
  type CreateMemberAccountInput,
  createMemberAccountSchema,
  type RemoveMemberInput,
  removeMemberSchema,
  type TransferOwnershipInput,
  transferOwnershipSchema,
} from "./schemas";

/**
 * Cria a conta de uma pessoa direto (nome + email + senha) e libera o acesso
 * ao workspace, sem depender de email de convite/confirmação.
 *
 * Usa a Admin API (service role) porque:
 * - `email_confirm: true` marca o email como confirmado na hora (a pessoa
 *   consegue logar mesmo com "confirmar email" ligado no projeto);
 * - grava a membership bypassando RLS (o profile é criado pelo trigger
 *   `on_auth_user_created`).
 *
 * Só owner/admin pode chamar. A senha é definida por quem cria e repassada
 * manualmente pra pessoa.
 */
export async function createMemberAccountAction(
  input: CreateMemberAccountInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = createMemberAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const email = parsed.data.email.trim().toLowerCase();
  const fullName = parsed.data.fullName.trim();
  const admin = createServiceClient();

  // 1. Cria o usuário já confirmado.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createErr || !created?.user) {
    const msg = createErr?.message?.toLowerCase() ?? "";
    if (msg.includes("already") && (msg.includes("registered") || msg.includes("exist"))) {
      return {
        ok: false,
        error: "Já existe uma conta com esse email. Peça pra pessoa entrar com a senha dela.",
      };
    }
    logError("members.createAccount", createErr);
    return { ok: false, error: "Não foi possível criar a conta. Tente novamente." };
  }

  const userId = created.user.id;

  // 2. Libera o acesso (grava a membership).
  const { error: memErr } = await admin.from("memberships").insert({
    organization_id: org.id,
    user_id: userId,
    role: parsed.data.role,
  });

  if (memErr) {
    // Rollback: remove o usuário recém-criado pra não deixar conta órfã sem acesso.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    if (memErr.code === "23505") {
      return { ok: false, error: "Essa pessoa já é membro do workspace." };
    }
    logError("members.createAccount.membership", memErr);
    return { ok: false, error: "A conta foi criada, mas falhou ao liberar o acesso. Tente de novo." };
  }

  // 3. Limpa qualquer convite antigo desse email nesta org (evita "fantasmas").
  await admin.from("invitations").delete().eq("organization_id", org.id).eq("email", email);

  revalidatePath(`/app/${parsed.data.orgSlug}/settings/members`);
  return { ok: true };
}

export async function changeMemberRoleAction(
  input: ChangeRoleInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = changeRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const supabase = await createClient();

  const { data: target } = await supabase
    .from("memberships")
    .select("role")
    .eq("id", parsed.data.membershipId)
    .eq("organization_id", org.id)
    .maybeSingle();

  if (!target) return { ok: false, error: "Membro não encontrado" };
  if (target.role === "owner")
    return { ok: false, error: "Não dá pra mudar o role do dono. Use transferir propriedade." };

  const { error } = await supabase
    .from("memberships")
    .update({ role: parsed.data.newRole })
    .eq("id", parsed.data.membershipId);

  if (error) {
    logError("members.changeRole", error);
    return { ok: false, error: "Erro ao alterar role. Tente novamente." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/settings/members`);
  return { ok: true };
}

export async function removeMemberAction(
  input: RemoveMemberInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = removeMemberSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const supabase = await createClient();

  const { data: target } = await supabase
    .from("memberships")
    .select("role")
    .eq("id", parsed.data.membershipId)
    .eq("organization_id", org.id)
    .maybeSingle();

  if (!target) return { ok: false, error: "Membro não encontrado" };
  if (target.role === "owner") return { ok: false, error: "Não dá pra remover o dono" };

  const { error } = await supabase.from("memberships").delete().eq("id", parsed.data.membershipId);

  if (error) {
    logError("members.remove", error);
    return { ok: false, error: "Erro ao remover membro. Tente novamente." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/settings/members`);
  return { ok: true };
}

/**
 * R4-CRIT-2: RPC agora recebe `_org_id` explícito + filtra dentro do FOR
 * UPDATE. Action passa `org.id` obtido pelo requireOrgRole (validado).
 * Antes a RPC pegava qualquer membership owner do caller — bug que
 * transferia a org errada quando o user era owner de múltiplas.
 */
export async function transferOwnershipAction(
  input: TransferOwnershipInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = transferOwnershipSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { user, org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner"],
  });

  if (user.id === parsed.data.targetUserId) {
    return { ok: false, error: "Você já é o dono" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_ownership", {
    _org_id: org.id,
    _target_user_id: parsed.data.targetUserId,
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("not a member")) return { ok: false, error: "Usuário não é membro" };
    if (msg.includes("cannot transfer to self")) return { ok: false, error: "Você já é o dono" };
    if (msg.includes("not owner")) return { ok: false, error: "Só o dono pode transferir" };
    logError("members.transfer", error);
    return { ok: false, error: "Falha ao transferir. Tente novamente." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/settings/members`);
  revalidatePath("/app", "layout");
  return { ok: true };
}

/**
 * R3-BIZ-005: self-leave para member não-owner.
 */
export async function leaveOrganizationAction(
  orgSlug: string,
): Promise<{ ok: false; error: string } | never> {
  const { user, org, role } = await requireOrgMember({ orgSlug });
  if (role === "owner") {
    return {
      ok: false,
      error: "Dono não pode sair. Transfira a propriedade primeiro.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("memberships")
    .delete()
    .eq("organization_id", org.id)
    .eq("user_id", user.id);

  if (error) {
    logError("members.leave", error);
    return { ok: false, error: "Falha ao sair do workspace. Tente novamente." };
  }

  revalidatePath("/app", "layout");
  redirect("/onboarding");
}
