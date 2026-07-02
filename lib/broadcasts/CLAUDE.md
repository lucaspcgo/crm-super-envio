# CLAUDE.md — lib/broadcasts

Disparador em massa: envia uma mensagem de **texto** (com variáveis) ou **mídia**
(imagem/vídeo/áudio/documento com legenda) pra vários contatos — da agenda, por
tag, ou números avulsos — com rotação de instâncias WhatsApp Evolution e anti-ban
(delay + pausa por lote + limite diário + sufixo de emoji). Roda em background.

## Interativa (POC: reply/botões)

`message_type='interactive'` guarda a config em `interactive` (jsonb). Hoje só o
tipo **reply**: `{ type:'reply', title, body, footer, buttons:[{label,id}] }`. O
worker chama `sendReplyButtons` (`lib/broadcasts/send-interactive.ts`), que bate
em `POST /message/sendButtons/{instância}` reusando `postJson`/`evolutionConfigSchema`
do adapter. **Depende de Evolution 2.4.0-rc2+** e o WhatsApp restringe botões na
API não-oficial — pode não renderizar. CTA/PIX/Lista/Carrossel ficam pra depois
(o jsonb `interactive` comporta esses formatos no futuro).

## Mídia

`message_type='media'` guarda `media_type`, `media_path` (caminho no bucket
privado `broadcast-media`) e `media_mime`. O upload é via `uploadBroadcastMediaAction`
(base64 → service role → storage). O worker gera uma **signed URL curta a cada
envio** (`signBroadcastMedia`, TTL 5min) — não guarda URL fixa porque o disparo
pode levar horas. `message_body` vira a legenda. Depende de `bodySizeLimit` maior
em `next.config.ts` (uploads passam por Server Action).

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

1. `createBroadcastAction` resolve os destinatários — **todos** os contatos, **por
   tag**, ou **números avulsos** (colados à mão, `contact_id=null`) — normaliza/dedupe
   telefones, cria o `broadcast` (`status='running'`, `next_send_at=now`) + os targets.
2. O worker (`lib/jobs/index.ts`, a cada 3s) pega disparos `running` com
   `next_send_at <= now`, escolhe a instância (respeitando limite diário via
   `count` de sent hoje por `channel_id`), envia via `evolutionAdapter.sendMessage`
   **direto pro número** (não cria conversa na inbox), grava o resultado e agenda
   o próximo com delay aleatório entre `delay_min/max`. Anti-ban por lote: a cada
   `batch_size` mensagens enviadas, a próxima é agendada só depois de `pause_minutes`
   (0 = sem pausa por lote). Se `random_emoji_suffix`, acrescenta um emoji aleatório
   no fim de cada mensagem (`withRandomEmoji`).
3. Sem mais `queued` → `status='done'`. Todas as instâncias no limite → adia 1h.

## Fora de escopo (Fases 2-3)

Mídia/arquivos, importar CSV, mensagem interativa (botões), agendamento, pausa por
lote. O form mostra essas opções como "em breve".

## Atenção

- Envio em massa por Evolution (API não-oficial) tem **risco de ban** e pode ferir
  o ToS do WhatsApp. Sempre testar com a instância de teste primeiro.
- Depende de `SUPABASE_SERVICE_ROLE_KEY` no env (worker + escolha de instância).
