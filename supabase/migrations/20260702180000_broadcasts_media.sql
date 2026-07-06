-- Disparo de mídia: imagem/vídeo/áudio/documento com legenda.
-- Guarda só o caminho no storage (media_path); o worker gera uma signed URL
-- curta a cada envio (o disparo pode levar horas, então URL fixa expiraria).

alter table public.broadcasts drop constraint broadcasts_message_type_check;
alter table public.broadcasts
  add constraint broadcasts_message_type_check check (message_type in ('text', 'media'));

alter table public.broadcasts
  add column media_type text check (media_type in ('image', 'video', 'audio', 'document')),
  add column media_path text,
  add column media_mime text;

-- Bucket privado da mídia de disparo (acesso só via service role / signed URL).
insert into storage.buckets (id, name, public)
values ('broadcast-media', 'broadcast-media', false)
on conflict (id) do nothing;
