-- Anti-ban: pausa a cada lote. `pause_minutes` = quanto pausar (0 = sem pausa),
-- `batch_size` = quantas mensagens antes de cada pausa.
alter table public.broadcasts
  add column pause_minutes int not null default 5 check (pause_minutes >= 0),
  add column batch_size int not null default 50 check (batch_size >= 1);
