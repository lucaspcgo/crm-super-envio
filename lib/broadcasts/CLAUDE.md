# CLAUDE.md — lib/broadcasts

Disparador em massa (Fase 1): envia uma mensagem de **texto** com variáveis pra
vários contatos da agenda, com rotação de instâncias WhatsApp Evolution e
anti-ban (delay + limite diário por instância). Roda em background.

## Arquivos

- `schemas.ts` — `createBroadcastSchema` (Zod). Números são `z.number()` (NÃO
  `z.coerce`, que quebra a tipagem do `useForm`); o form registra os inputs com
  `valueAsNumber: true`.
- `queries.ts` — reads (`getBroadcasts`, `getBroadcast`, `getBroadcastTargets`,
  `getEvolutionChannels`, `resolveTargetContacts`).
- `send.ts` — `normalizePhone`, `interpolateBody` (reusa `interpolate` das
  automações), `pickChannelForBroadcast` (rotação + limite diário), `sendViaChannel`.
- `worker.ts` — `processNextBroadcastSends`: 1 tick, envia **1** destinatário por
  disparo (serializa → respeita o delay), reagenda `next_send_at`.
- `recovery.ts` — targets presos em `sending` > 5min voltam pra `queued`.
- `actions.ts` — `createBroadcastAction` + `pause/resume/cancel` (owner/admin).

## Tabelas (migration `20260702120000_broadcasts.sql`)

- `broadcasts` — a campanha (mensagem, instâncias, anti-ban, contadores,
  `next_send_at` pro pacing, `status`).
- `broadcast_targets` — 1 linha por destinatário (`queued→sending→sent/failed`).

RLS org-scoped: members leem; owner/admin escrevem. Só `enable` (FORCE é proibido
no projeto). O worker usa **service role** (bypassa RLS) porque roda fora de request.

## Como o envio funciona

1. `createBroadcastAction` resolve os contatos (todos ou por tag), normaliza/dedupe
   telefones, cria o `broadcast` (`status='running'`, `next_send_at=now`) + os targets.
2. O worker (`lib/jobs/index.ts`, a cada 3s) pega disparos `running` com
   `next_send_at <= now`, escolhe a instância (respeitando limite diário via
   `count` de sent hoje por `channel_id`), envia via `evolutionAdapter.sendMessage`
   **direto pro número** (não cria conversa na inbox), grava o resultado e agenda
   o próximo com delay aleatório entre `delay_min/max`.
3. Sem mais `queued` → `status='done'`. Todas as instâncias no limite → adia 1h.

## Fora de escopo (Fases 2-3)

Mídia/arquivos, importar CSV, mensagem interativa (botões), agendamento, pausa por
lote. O form mostra essas opções como "em breve".

## Atenção

- Envio em massa por Evolution (API não-oficial) tem **risco de ban** e pode ferir
  o ToS do WhatsApp. Sempre testar com a instância de teste primeiro.
- Depende de `SUPABASE_SERVICE_ROLE_KEY` no env (worker + escolha de instância).
