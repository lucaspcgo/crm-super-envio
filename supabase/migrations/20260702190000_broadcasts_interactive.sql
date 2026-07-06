-- Mensagem interativa (Fase POC: Reply/botões). A config vai num JSONB flexível
-- pra comportar os outros tipos (CTA/PIX/Lista/Carrossel) no futuro.
alter table public.broadcasts drop constraint broadcasts_message_type_check;
alter table public.broadcasts
  add constraint broadcasts_message_type_check
  check (message_type in ('text', 'media', 'interactive'));

alter table public.broadcasts add column interactive jsonb;
