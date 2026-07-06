-- Anti-ban: sufixo de emoji aleatório. Quando ligado, o worker acrescenta um
-- emoji aleatório no fim de cada mensagem (deixa cada envio um pouco diferente).
alter table public.broadcasts
  add column random_emoji_suffix boolean not null default false;
