# CLAUDE.md — lib/members

Gestão de membros da org (criar acesso, mudar role, remover, transferir ownership).

- `schemas.ts` — Zod (userId, role, e `createMemberAccountSchema`: nome/email/senha/role)
- `actions.ts` — `createMemberAccountAction`, `updateMemberRoleAction`, `removeMemberAction`, `transferOwnershipAction`

## Criar acesso direto (`createMemberAccountAction`)

Fluxo principal de adicionar gente ao workspace **sem depender de email**. Owner/admin
informa nome + email + senha; a action cria a conta já usável e libera o acesso.

Por que usa **service role** (`createServiceClient`) — um dos poucos casos onde bypass de RLS é legítimo (ver `lib/supabase/CLAUDE.md`):
1. `admin.auth.admin.createUser({ email_confirm: true, user_metadata: { full_name } })` — cria o usuário **já confirmado** (loga mesmo com "Confirm email" ligado no projeto). O `profile` é criado pelo trigger `on_auth_user_created`, que lê `raw_user_meta_data ->> 'full_name'`.
2. Grava a `membership` bypassando RLS.
3. Limpa convites antigos daquele email na org.

Se o insert da membership falhar, faz **rollback** removendo o usuário recém-criado (`admin.auth.admin.deleteUser`) pra não deixar conta órfã.

**Depende de `SUPABASE_SERVICE_ROLE_KEY` no env** (inclusive em produção/Vercel). UI: `create-member-dialog.tsx` na página de membros.

> O fluxo de convite por email (`lib/invitations/`) continua existindo, mas não é o caminho padrão — só funciona com `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` configurados.

Transferência de ownership usa RPC `transfer_ownership` (atomic: rebaixa owner atual a admin + promove o novo) — não dá pra fazer em 2 updates separados sem corromper o estado.

Owner é sempre **exatamente 1** por org. Toda action aqui valida esse invariante via `requireOrgRole(["owner"])` ou checks dentro do RPC.
