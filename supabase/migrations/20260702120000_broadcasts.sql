-- Disparador em Massa (Fase 1): campanhas de envio + destinatários.
-- Envio real roda no worker de background (lib/broadcasts/worker.ts) via service role.

create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  message_type text not null default 'text' check (message_type in ('text')),
  message_body text not null,
  instance_mode text not null default 'specific' check (instance_mode in ('specific', 'rotate')),
  instance_channel_ids uuid[] not null default '{}',
  delay_min_seconds int not null default 8 check (delay_min_seconds >= 1),
  delay_max_seconds int not null default 25 check (delay_max_seconds >= delay_min_seconds),
  daily_limit_per_instance int not null default 800 check (daily_limit_per_instance >= 1),
  status text not null default 'running'
    check (status in ('draft', 'running', 'paused', 'done', 'failed', 'canceled')),
  total_targets int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  next_send_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.broadcast_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  phone text not null,
  name text,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  channel_id uuid references public.channels(id) on delete set null,
  external_id text,
  error text,
  sending_started_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index broadcasts_organization_id_idx on public.broadcasts(organization_id);
create index broadcasts_org_status_idx on public.broadcasts(organization_id, status);
create index broadcast_targets_broadcast_status_idx on public.broadcast_targets(broadcast_id, status);
create index broadcast_targets_channel_sent_idx on public.broadcast_targets(channel_id, sent_at);

-- Triggers (padrão do projeto). broadcast_targets não tem updated_at/created_by,
-- então não leva set_updated_at nem freeze_org_and_creator.
create trigger broadcasts_set_updated_at
  before update on public.broadcasts
  for each row execute function public.set_updated_at();

create trigger broadcasts_freeze_org_and_creator
  before update on public.broadcasts
  for each row execute function public.freeze_org_and_creator();

-- RLS: apenas ENABLE (FORCE é proibido no projeto — recursão com helpers SECURITY DEFINER).
alter table public.broadcasts enable row level security;
alter table public.broadcast_targets enable row level security;

create policy "members read broadcasts"
  on public.broadcasts for select
  using (public.is_org_member(organization_id));

create policy "admins insert broadcasts"
  on public.broadcasts for insert
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and auth.uid() = created_by
  );

create policy "admins update broadcasts"
  on public.broadcasts for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

create policy "admins delete broadcasts"
  on public.broadcasts for delete
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- Targets: membros leem; admins inserem (a action cria em lote). UPDATE/DELETE de
-- targets só acontece pelo worker (service role, bypassa RLS) ou cascade — sem policy.
create policy "members read broadcast_targets"
  on public.broadcast_targets for select
  using (public.is_org_member(organization_id));

create policy "admins insert broadcast_targets"
  on public.broadcast_targets for insert
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));
