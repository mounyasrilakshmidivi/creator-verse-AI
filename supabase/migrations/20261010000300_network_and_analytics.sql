-- =====================================================================
-- CreatorVerse AI: login analytics, member profiles, collaboration requests,
-- messaging and connections. Additive: no tables or data are dropped.
-- Requires the three earlier migrations.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Profile extensions (all optional; visibility is chosen by the owner)
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists last_active_at timestamptz;

alter table public.creator_profiles add column if not exists portfolio_links text[] not null default '{}'
  check (cardinality(portfolio_links) <= 12);
alter table public.creator_profiles add column if not exists skills text[] not null default '{}'
  check (cardinality(skills) <= 20);
alter table public.creator_profiles add column if not exists availability text not null default 'open'
  check (availability in ('open', 'limited', 'unavailable'));
alter table public.creator_profiles add column if not exists show_social_links boolean not null default true;

alter table public.brand_profiles add column if not exists published boolean not null default false;
alter table public.brand_profiles add column if not exists logo_url text check (logo_url is null or logo_url ~ '^https://\S+$');
alter table public.brand_profiles add column if not exists website text check (website is null or website ~ '^https?://\S+\.\S+$');
alter table public.brand_profiles add column if not exists social_links jsonb not null default '{}';
alter table public.brand_profiles add column if not exists campaign_requirements text not null default ''
  check (char_length(campaign_requirements) <= 2000);
alter table public.brand_profiles add column if not exists collaboration_opportunities text not null default ''
  check (char_length(collaboration_opportunities) <= 2000);

-- Self-reported audience statistics live in their own table so the owner can hide them.
create table if not exists public.creator_stats (
  user_id uuid primary key references public.creator_profiles (user_id) on delete cascade,
  followers integer check (followers is null or followers between 0 and 2000000000),
  engagement_rate numeric(5, 2) check (engagement_rate is null or engagement_rate between 0 and 100),
  avg_views integer check (avg_views is null or avg_views between 0 and 2000000000),
  visible boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.creator_stats enable row level security;
drop policy if exists "creator stats owner" on public.creator_stats;
create policy "creator stats owner" on public.creator_stats for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Social links: respect the new "show social links" choice (replaces the earlier, broader policy).
drop policy if exists "social links of published creators" on public.creator_social_links;
create policy "social links of published creators" on public.creator_social_links for select to authenticated
  using (exists (select 1 from public.creator_profiles c
                 where c.user_id = creator_social_links.user_id and c.published and c.show_social_links));

-- Is this user a published, active member others may view and contact?
create or replace function public.is_public_member(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_user(p_user) and (
    exists (select 1 from public.creator_profiles where user_id = p_user and published)
    or exists (select 1 from public.brand_profiles where user_id = p_user and published))
$$;
revoke execute on function public.is_public_member from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Login analytics (admin-only; no passwords, tokens or IP addresses)
-- ---------------------------------------------------------------------
create table if not exists public.login_events (
  id bigint generated always as identity primary key,
  event_uid uuid not null default gen_random_uuid() unique,
  user_id uuid references auth.users (id) on delete set null,
  email text,
  role text,
  status text not null check (status in ('success', 'failure')),
  failure_reason text check (failure_reason is null or failure_reason in ('invalid_credentials', 'email_not_confirmed', 'other')),
  method text not null default 'password',
  source text not null check (source in ('auth', 'client_report')),
  occurred_at timestamptz not null default now()
);
create index if not exists login_events_time_idx on public.login_events (occurred_at desc);
create index if not exists login_events_user_idx on public.login_events (user_id, occurred_at desc);
create index if not exists login_events_email_idx on public.login_events (email, occurred_at desc);
alter table public.login_events enable row level security;  -- no policies: readable only through admin functions

insert into public.app_settings (key, value, description) values
  ('login_events_retention_days', '180', 'Login events older than this many days are deleted by purge_login_events().')
on conflict (key) do nothing;

-- Successful sign-ins: Supabase Auth updates auth.users.last_sign_in_at on every password, Google or code sign-in.
create or replace function public.on_auth_user_signed_in() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.last_sign_in_at is not null and new.last_sign_in_at is distinct from old.last_sign_in_at then
    insert into public.login_events (user_id, email, role, status, method, source, occurred_at)
    values (new.id, lower(new.email), (select role from public.profiles where id = new.id), 'success',
            coalesce(new.raw_app_meta_data ->> 'provider', 'password'), 'auth', new.last_sign_in_at);
    update public.profiles set last_active_at = new.last_sign_in_at where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_signed_in on auth.users;
create trigger on_auth_user_signed_in after update of last_sign_in_at on auth.users
  for each row execute function public.on_auth_user_signed_in();

-- Failed sign-ins never reach the database inside Supabase Auth (Free plan), so the browser reports them
-- after Supabase rejects a login. Insert-only, rate-limited, flagged as client_report, readable by admins only.
create or replace function public.record_login_failure(p_email text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(coalesce(p_email, '')));
begin
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or char_length(v_email) > 254 then return; end if;
  if p_reason not in ('invalid_credentials', 'email_not_confirmed', 'other') then p_reason := 'other'; end if;
  -- rate limits: 10 per email per 10 minutes, 300 per minute overall
  if (select count(*) from public.login_events where email = v_email and status = 'failure'
        and occurred_at > now() - interval '10 minutes') >= 10 then return; end if;
  if (select count(*) from public.login_events where source = 'client_report'
        and occurred_at > now() - interval '1 minute') >= 300 then return; end if;
  insert into public.login_events (user_id, email, role, status, failure_reason, method, source)
  select u.id, v_email, p.role, 'failure', p_reason, 'password', 'client_report'
  from (select 1) x
  left join auth.users u on lower(u.email) = v_email
  left join public.profiles p on p.id = u.id;
end $$;
revoke execute on function public.record_login_failure from public;
grant execute on function public.record_login_failure to anon, authenticated;

-- Last activity (throttled to one write per 5 minutes per user)
create or replace function public.touch_activity() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set last_active_at = now()
  where id = auth.uid() and (last_active_at is null or last_active_at < now() - interval '5 minutes')
$$;
revoke execute on function public.touch_activity from public, anon;
grant execute on function public.touch_activity to authenticated;

create or replace function public.purge_login_events() returns integer
language sql security definer set search_path = '' as $$
  with d as (
    delete from public.login_events
    where occurred_at < now() - make_interval(days => coalesce(
      (select (value #>> '{}')::integer from public.app_settings where key = 'login_events_retention_days'), 180))
    returning 1)
  select count(*)::integer from d
$$;
revoke execute on function public.purge_login_events from public, anon, authenticated;
grant execute on function public.purge_login_events to service_role;

-- Paginated, filtered login report for admins (used by the dashboard table and the Excel export)
create or replace function public.admin_login_events(
  p_from timestamptz default null, p_to timestamptz default null, p_role text default null,
  p_status text default null, p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns table (event_id uuid, user_id uuid, user_name text, email text, user_role text, status text, failure_reason text,
               method text, source text, occurred_at timestamptz, account_created_at timestamptz, last_activity timestamptz,
               total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select e.event_uid, e.user_id, p.full_name, e.email, coalesce(p.role, e.role), e.status, e.failure_reason,
           e.method, e.source, e.occurred_at, p.created_at, greatest(p.last_active_at, u.last_sign_in_at),
           count(*) over ()
    from public.login_events e
    left join public.profiles p on p.id = e.user_id
    left join auth.users u on u.id = e.user_id
    where (p_from is null or e.occurred_at >= p_from)
      and (p_to is null or e.occurred_at < p_to)
      and (p_role is null or coalesce(p.role, e.role) = p_role)
      and (p_status is null or e.status = p_status)
      and (p_search is null or e.email ilike '%' || p_search || '%' or p.full_name ilike '%' || p_search || '%'
           or e.user_id::text = p_search)
    order by e.occurred_at desc
    limit greatest(1, least(p_limit, 5000)) offset greatest(0, p_offset);
end $$;
revoke execute on function public.admin_login_events from public, anon;
grant execute on function public.admin_login_events to authenticated;

-- ---------------------------------------------------------------------
-- Connections
-- ---------------------------------------------------------------------
create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
create unique index if not exists connections_active_pair on public.connections
  (least(requester_id, addressee_id), greatest(requester_id, addressee_id)) where status in ('pending', 'accepted');
alter table public.connections enable row level security;
drop policy if exists "participants see connections" on public.connections;
create policy "participants see connections" on public.connections for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));
-- no insert/update policies: changes go through the functions below

create or replace function public.are_connected(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.connections where status = 'accepted'
    and ((requester_id = p_a and addressee_id = p_b) or (requester_id = p_b and addressee_id = p_a)))
$$;
revoke execute on function public.are_connected from public, anon, authenticated;

create or replace function public.request_connection(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_c public.connections; v_name text;
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_user = v_me then raise exception 'You cannot connect with yourself.'; end if;
  if not public.is_active_user(v_me) then raise exception 'account_not_active' using errcode = '42501'; end if;
  if not public.is_public_member(p_user) then raise exception 'This member is not available for connections.'; end if;
  select * into v_c from public.connections
  where status in ('pending', 'accepted') and least(requester_id, addressee_id) = least(v_me, p_user)
    and greatest(requester_id, addressee_id) = greatest(v_me, p_user);
  if v_c.status = 'accepted' then return jsonb_build_object('id', v_c.id, 'status', 'accepted'); end if;
  if v_c.status = 'pending' and v_c.requester_id = v_me then raise exception 'Your connection request is already pending.'; end if;
  if v_c.status = 'pending' then  -- they already asked us: accept instead of duplicating
    update public.connections set status = 'accepted', responded_at = now() where id = v_c.id;
    return jsonb_build_object('id', v_c.id, 'status', 'accepted');
  end if;
  if exists (select 1 from public.connections where requester_id = v_me and addressee_id = p_user
             and status = 'declined' and responded_at > now() - interval '7 days') then
    raise exception 'This member declined recently. You can ask again after 7 days.';
  end if;
  if (select count(*) from public.connections where requester_id = v_me and created_at > now() - interval '1 day') >= 50 then
    raise exception 'Daily connection request limit reached. Try again tomorrow.';
  end if;
  insert into public.connections (requester_id, addressee_id) values (v_me, p_user) returning * into v_c;
  return jsonb_build_object('id', v_c.id, 'status', 'pending');
end $$;
revoke execute on function public.request_connection from public, anon;
grant execute on function public.request_connection to authenticated;

create or replace function public.respond_connection(p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_c public.connections; v_me uuid := auth.uid();
begin
  select * into v_c from public.connections where id = p_id for update;
  if v_c.id is null or v_me not in (v_c.requester_id, v_c.addressee_id) then raise exception 'Connection not found.'; end if;
  if p_action in ('accept', 'decline') then
    if v_me <> v_c.addressee_id or v_c.status <> 'pending' then raise exception 'Only the recipient can answer a pending request.'; end if;
    update public.connections set status = case p_action when 'accept' then 'accepted' else 'declined' end, responded_at = now() where id = p_id;
  elsif p_action = 'withdraw' then
    if not ((v_c.status = 'pending' and v_me = v_c.requester_id) or v_c.status = 'accepted') then
      raise exception 'This connection cannot be withdrawn.';
    end if;
    update public.connections set status = 'withdrawn', responded_at = now() where id = p_id;
  else
    raise exception 'Unknown action %', p_action;
  end if;
end $$;
revoke execute on function public.respond_connection from public, anon;
grant execute on function public.respond_connection to authenticated;

create or replace function public.on_connection_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    select full_name into v_name from public.profiles where id = new.requester_id;
    perform public.enqueue_event(new.addressee_id, 'connection_request', format('%s wants to connect', coalesce(nullif(v_name, ''), 'A member')),
      'Accept or decline in My Connections.', '#/connections', 'connection_request', jsonb_build_object('name', v_name),
      'conn-req:' || new.id, 'activity');
  elsif new.status = 'accepted' and old.status = 'pending' then
    select full_name into v_name from public.profiles where id = new.addressee_id;
    perform public.enqueue_event(new.requester_id, 'connection_accepted', format('%s accepted your connection request', coalesce(nullif(v_name, ''), 'A member')),
      'You are now connected and can message each other.', '#/u/' || new.addressee_id, 'connection_accepted',
      jsonb_build_object('name', v_name), 'conn-acc:' || new.id, 'activity');
  end if;
  return new;
end $$;
drop trigger if exists on_connection_change on public.connections;
create trigger on_connection_change after insert or update of status on public.connections
  for each row execute function public.on_connection_change();

-- ---------------------------------------------------------------------
-- Conversations & messages
-- ---------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  check (user_a < user_b),
  unique (user_a, user_b)
);
alter table public.conversations enable row level security;
drop policy if exists "participants see conversations" on public.conversations;
create policy "participants see conversations" on public.conversations for select to authenticated
  using (auth.uid() in (user_a, user_b));

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  kind text not null default 'text' check (kind in ('text', 'system')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);
alter table public.messages enable row level security;
drop policy if exists "participants read messages" on public.messages;
create policy "participants read messages" on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b)));
drop policy if exists "participants send messages" on public.messages;
create policy "participants send messages" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and kind = 'text'
    and exists (select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b)));

create table if not exists public.conversation_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.conversation_reads enable row level security;
drop policy if exists "own read markers" on public.conversation_reads;
create policy "own read markers" on public.conversation_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Internal: get or create the conversation between two users
create or replace function public._conversation_between(p_a uuid, p_b uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.conversations (user_a, user_b) values (least(p_a, p_b), greatest(p_a, p_b))
  on conflict (user_a, user_b) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.conversations where user_a = least(p_a, p_b) and user_b = greatest(p_a, p_b); end if;
  return v_id;
end $$;
revoke execute on function public._conversation_between from public, anon, authenticated;

-- Start (or reopen) a conversation. Allowed with published members, connections, or collaboration partners.
create or replace function public.start_conversation(p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_user = v_me then raise exception 'You cannot message yourself.'; end if;
  if not public.is_active_user(v_me) then raise exception 'account_not_active' using errcode = '42501'; end if;
  if not (public.is_public_member(p_user) or public.are_connected(v_me, p_user)
          or exists (select 1 from public.collaboration_requests where status <> 'declined'
                     and ((sender_id = v_me and recipient_id = p_user) or (sender_id = p_user and recipient_id = v_me)))
          or exists (select 1 from public.conversations where user_a = least(v_me, p_user) and user_b = greatest(v_me, p_user))) then
    raise exception 'This member is not available for messages.';
  end if;
  if not exists (select 1 from public.conversations where user_a = least(v_me, p_user) and user_b = greatest(v_me, p_user))
     and (select count(*) from public.conversations where v_me in (user_a, user_b) and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Daily limit for new conversations reached. Try again tomorrow.';
  end if;
  return public._conversation_between(v_me, p_user);
end $$;
revoke execute on function public.start_conversation from public, anon;
grant execute on function public.start_conversation to authenticated;

create or replace function public.on_message_sent() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_c public.conversations; v_to uuid; v_name text;
begin
  if new.kind = 'text' and not public.is_active_user(new.sender_id) then
    raise exception 'account_not_active' using errcode = '42501';
  end if;
  if new.kind = 'text' and (select count(*) from public.messages where sender_id = new.sender_id
        and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'You are sending messages too quickly. Please wait a moment.';
  end if;
  new.body := btrim(new.body);
  new.created_at := now();
  select * into v_c from public.conversations where id = new.conversation_id;
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  if new.sender_id is not null then
    insert into public.conversation_reads (conversation_id, user_id, last_read_at) values (new.conversation_id, new.sender_id, new.created_at)
    on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  end if;
  if new.kind = 'text' then
    v_to := case when v_c.user_a = new.sender_id then v_c.user_b else v_c.user_a end;
    select full_name into v_name from public.profiles where id = new.sender_id;
    -- at most one notification per conversation per hour (no email for chat messages)
    perform public.enqueue_event(v_to, 'new_message', format('New message from %s', coalesce(nullif(v_name, ''), 'a member')),
      left(new.body, 120), '#/messages/m-' || new.conversation_id, null, null,
      'msg:' || new.conversation_id || ':' || v_to || ':' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24'), 'activity');
  end if;
  return new;
end $$;
drop trigger if exists on_message_sent on public.messages;
create trigger on_message_sent before insert on public.messages for each row execute function public.on_message_sent();

-- Inbox: one row per conversation with the other participant, last message and unread count
create or replace function public.list_conversations() returns table (
  id uuid, other_id uuid, other_name text, other_avatar text, other_role text,
  last_body text, last_at timestamptz, unread integer, connected boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, o.id, o.full_name, o.avatar_url, o.role,
         (select m.body from public.messages m where m.conversation_id = c.id order by m.created_at desc limit 1),
         coalesce(c.last_message_at, c.created_at),
         (select count(*)::integer from public.messages m where m.conversation_id = c.id and m.kind = 'text' and m.sender_id is distinct from auth.uid()
            and m.created_at > coalesce((select r.last_read_at from public.conversation_reads r where r.conversation_id = c.id and r.user_id = auth.uid()), '-infinity')),
         public.are_connected(auth.uid(), o.id)
  from public.conversations c
  join public.profiles o on o.id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
  where auth.uid() in (c.user_a, c.user_b)
  order by coalesce(c.last_message_at, c.created_at) desc
$$;
revoke execute on function public.list_conversations from public, anon;
grant execute on function public.list_conversations to authenticated;

create or replace function public.mark_conversation_read(p_conversation uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.conversations where id = p_conversation and auth.uid() in (user_a, user_b)) then
    raise exception 'Conversation not found.';
  end if;
  insert into public.conversation_reads (conversation_id, user_id, last_read_at) values (p_conversation, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();
  update public.notifications set read_at = now()
  where user_id = auth.uid() and kind = 'new_message' and read_at is null and link = '#/messages/m-' || p_conversation;
end $$;
revoke execute on function public.mark_conversation_read from public, anon;
grant execute on function public.mark_conversation_read to authenticated;

-- ---------------------------------------------------------------------
-- Member-to-member collaboration requests
-- ---------------------------------------------------------------------
create table if not exists public.collaboration_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null check (char_length(btrim(subject)) between 3 and 140),
  purpose text not null check (char_length(btrim(purpose)) between 3 and 140),
  campaign_details text not null default '' check (char_length(campaign_details) <= 3000),
  budget integer check (budget is null or budget between 0 and 100000000),
  message text not null check (char_length(btrim(message)) between 10 and 3000),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'completed')),
  response_note text check (response_note is null or char_length(response_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> recipient_id)
);
create unique index if not exists collab_one_pending on public.collaboration_requests (sender_id, recipient_id) where status = 'pending';
create index if not exists collab_recipient_idx on public.collaboration_requests (recipient_id, created_at desc);
alter table public.collaboration_requests enable row level security;
drop policy if exists "participants see collaboration requests" on public.collaboration_requests;
create policy "participants see collaboration requests" on public.collaboration_requests for select to authenticated
  using (auth.uid() in (sender_id, recipient_id));
drop policy if exists "members send collaboration requests" on public.collaboration_requests;
create policy "members send collaboration requests" on public.collaboration_requests for insert to authenticated
  with check (sender_id = auth.uid());
-- status changes only through respond_collaboration()

create or replace function public.collaboration_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- check the caller first so no other user's request state is revealed in error messages
  if auth.uid() is not null and new.sender_id is distinct from auth.uid() then
    raise exception 'You can only send requests from your own account.' using errcode = '42501';
  end if;
  if not public.is_active_user(new.sender_id) then raise exception 'account_not_active' using errcode = '42501'; end if;
  if not (public.is_public_member(new.recipient_id) or public.are_connected(new.sender_id, new.recipient_id)) then
    raise exception 'This member is not accepting collaboration requests.';
  end if;
  if exists (select 1 from public.collaboration_requests where sender_id = new.sender_id and recipient_id = new.recipient_id and status = 'pending') then
    raise exception 'You already have a pending collaboration request with this member.';
  end if;
  if (select count(*) from public.collaboration_requests where sender_id = new.sender_id and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Daily collaboration request limit reached. Try again tomorrow.';
  end if;
  new.status := 'pending'; new.response_note := null; new.responded_at := null;
  new.created_at := now(); new.updated_at := now();
  new.subject := btrim(new.subject); new.purpose := btrim(new.purpose); new.message := btrim(new.message);
  return new;
end $$;
drop trigger if exists collaboration_before_insert on public.collaboration_requests;
create trigger collaboration_before_insert before insert on public.collaboration_requests
  for each row execute function public.collaboration_before_insert();

create or replace function public.respond_collaboration(p_id uuid, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r public.collaboration_requests; v_me uuid := auth.uid(); v_new text; v_conv uuid;
begin
  select * into v_r from public.collaboration_requests where id = p_id for update;
  if v_r.id is null or v_me not in (v_r.sender_id, v_r.recipient_id) then raise exception 'Request not found.'; end if;
  v_new := case
    when p_action = 'accept' and v_me = v_r.recipient_id and v_r.status = 'pending' then 'accepted'
    when p_action = 'decline' and v_me = v_r.recipient_id and v_r.status = 'pending' then 'declined'
    when p_action = 'cancel' and v_me = v_r.sender_id and v_r.status = 'pending' then 'cancelled'
    when p_action = 'complete' and v_r.status = 'accepted' then 'completed'
    else null end;
  if v_new is null then raise exception 'That action is not allowed for this request.'; end if;
  update public.collaboration_requests set status = v_new, response_note = nullif(left(coalesce(p_note, ''), 1000), ''),
    responded_at = now(), updated_at = now() where id = p_id;
  if v_new = 'accepted' then
    v_conv := public._conversation_between(v_r.sender_id, v_r.recipient_id);
    insert into public.messages (conversation_id, sender_id, kind, body)
    values (v_conv, null, 'system', format('Collaboration accepted: "%s". Use this conversation to plan the details.', v_r.subject));
  end if;
  return jsonb_build_object('status', v_new, 'conversation_id', v_conv);
end $$;
revoke execute on function public.respond_collaboration from public, anon;
grant execute on function public.respond_collaboration to authenticated;

create or replace function public.on_collaboration_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_to uuid; v_actor uuid;
begin
  if tg_op = 'INSERT' then
    select full_name into v_name from public.profiles where id = new.sender_id;
    perform public.enqueue_event(new.recipient_id, 'member_collab_request',
      format('Collaboration request from %s', coalesce(nullif(v_name, ''), 'a member')), new.subject, '#/requests',
      'member_collab_request', jsonb_build_object('name', v_name, 'subject', new.subject, 'purpose', new.purpose, 'budget', new.budget),
      'mcollab:' || new.id, 'activity');
  elsif new.status is distinct from old.status then
    v_actor := case when new.status = 'cancelled' then new.sender_id when new.status in ('accepted', 'declined') then new.recipient_id else auth.uid() end;
    v_to := case when v_actor = new.sender_id then new.recipient_id else new.sender_id end;
    select full_name into v_name from public.profiles where id = v_actor;
    perform public.enqueue_event(v_to, 'member_collab_update',
      format('%s %s your collaboration request', coalesce(nullif(v_name, ''), 'A member'),
             case new.status when 'accepted' then 'accepted' when 'declined' then 'declined' when 'cancelled' then 'cancelled' else 'marked as completed' end),
      new.subject, case when new.status = 'accepted' then '#/messages' else '#/requests' end,
      'member_collab_update', jsonb_build_object('name', v_name, 'subject', new.subject, 'status', new.status),
      'mcollab:' || new.id || ':' || new.status, 'activity');
  end if;
  return new;
end $$;
drop trigger if exists on_collaboration_change on public.collaboration_requests;
create trigger on_collaboration_change after insert or update of status on public.collaboration_requests
  for each row execute function public.on_collaboration_change();

-- ---------------------------------------------------------------------
-- Member directory and profile view (only what the owner made visible)
-- ---------------------------------------------------------------------
create or replace function public.list_members(p_role text default null, p_search text default null, p_niche text default null,
                                               p_limit integer default 24, p_offset integer default 0)
returns table (id uuid, role text, name text, avatar_url text, headline text, city text, niches text[], availability text, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  return query
    select m.id, m.role, m.name, m.avatar_url, m.headline, m.city, m.niches, m.availability, count(*) over ()
    from (
      select p.id, 'creator'::text role, c.display_name name, p.avatar_url, left(c.bio, 160) headline, c.city, c.niches, c.availability
      from public.profiles p join public.creator_profiles c on c.user_id = p.id
      where c.published and p.role = 'creator' and public.is_active_user(p.id)
      union all
      select p.id, 'brand', b.business_name, coalesce(b.logo_url, p.avatar_url), left(b.description, 160), b.industry, '{}'::text[], null
      from public.profiles p join public.brand_profiles b on b.user_id = p.id
      where b.published and p.role = 'brand' and public.is_active_user(p.id)
    ) m
    where m.id <> auth.uid()
      and (p_role is null or m.role = p_role)
      and (p_niche is null or p_niche = any (m.niches))
      and (p_search is null or m.name ilike '%' || p_search || '%' or m.headline ilike '%' || p_search || '%' or m.city ilike '%' || p_search || '%')
    order by m.name
    limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
end $$;
revoke execute on function public.list_members from public, anon;
grant execute on function public.list_members to authenticated;

create or replace function public.get_member_profile(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_p public.profiles; v_c public.creator_profiles; v_b public.brand_profiles; v_s public.creator_stats;
  v_self boolean; v_visible boolean; v_conn public.connections; v_result jsonb;
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into v_p from public.profiles where id = p_user;
  if v_p.id is null then return null; end if;
  v_self := p_user = v_me;
  select * into v_c from public.creator_profiles where user_id = p_user;
  select * into v_b from public.brand_profiles where user_id = p_user;
  v_visible := v_self or public.is_public_member(p_user) or public.are_connected(v_me, p_user);
  if not v_visible then
    return jsonb_build_object('id', p_user, 'available', false);
  end if;
  select * into v_conn from public.connections
  where status in ('pending', 'accepted') and least(requester_id, addressee_id) = least(v_me, p_user)
    and greatest(requester_id, addressee_id) = greatest(v_me, p_user);
  v_result := jsonb_build_object(
    'id', v_p.id, 'available', true, 'is_self', v_self, 'role', v_p.role, 'name', coalesce(v_c.display_name, v_b.business_name, v_p.full_name),
    'avatar_url', coalesce(v_b.logo_url, v_p.avatar_url), 'member_since', v_p.created_at,
    'published', coalesce(v_c.published, v_b.published, false),
    'connection', case when v_conn.id is null then null else jsonb_build_object('id', v_conn.id, 'status', v_conn.status,
                    'direction', case when v_conn.requester_id = v_me then 'outgoing' else 'incoming' end) end,
    'pending_collaboration', exists (select 1 from public.collaboration_requests where status = 'pending'
                    and sender_id = v_me and recipient_id = p_user),
    'conversation_id', (select id from public.conversations where user_a = least(v_me, p_user) and user_b = greatest(v_me, p_user)));
  if v_p.role = 'creator' and v_c.user_id is not null then
    select * into v_s from public.creator_stats where user_id = p_user;
    v_result := v_result || jsonb_build_object('creator', jsonb_build_object(
      'bio', v_c.bio, 'niches', v_c.niches, 'languages', v_c.languages, 'city', v_c.city, 'price_from', v_c.price_from,
      'packages', v_c.packages, 'portfolio_links', v_c.portfolio_links, 'skills', v_c.skills, 'availability', v_c.availability,
      'social_links', case when v_c.show_social_links or v_self then
          (select coalesce(jsonb_object_agg(platform, url), '{}') from public.creator_social_links where user_id = p_user) else null end,
      'stats', case when v_s.user_id is not null and (v_s.visible or v_self) then
          jsonb_build_object('followers', v_s.followers, 'engagement_rate', v_s.engagement_rate, 'avg_views', v_s.avg_views) else null end));
  elsif v_p.role = 'brand' and v_b.user_id is not null then
    v_result := v_result || jsonb_build_object('brand', jsonb_build_object(
      'description', v_b.description, 'industry', v_b.industry, 'website', v_b.website, 'social_links', v_b.social_links,
      'campaign_requirements', v_b.campaign_requirements, 'collaboration_opportunities', v_b.collaboration_opportunities,
      'goals', v_b.goals, 'platforms', v_b.platforms, 'target_audience', v_b.target_audience,
      'open_campaigns', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'category', category)), '[]')
                         from public.campaigns where owner_id = p_user and status = 'open')));
  end if;
  return v_result;
end $$;
revoke execute on function public.get_member_profile from public, anon;
grant execute on function public.get_member_profile to authenticated;

-- The caller's connections and collaboration requests, with the other person's public name/avatar
create or replace function public.list_connections() returns table (
  id uuid, other_id uuid, other_name text, other_avatar text, other_role text, status text, direction text,
  created_at timestamptz, responded_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, o.id, coalesce(cp.display_name, bp.business_name, o.full_name), coalesce(bp.logo_url, o.avatar_url), o.role, c.status,
         case when c.requester_id = auth.uid() then 'outgoing' else 'incoming' end, c.created_at, c.responded_at
  from public.connections c
  join public.profiles o on o.id = case when c.requester_id = auth.uid() then c.addressee_id else c.requester_id end
  left join public.creator_profiles cp on cp.user_id = o.id
  left join public.brand_profiles bp on bp.user_id = o.id
  where auth.uid() in (c.requester_id, c.addressee_id) and c.status in ('pending', 'accepted')
  order by c.status = 'pending' desc, coalesce(c.responded_at, c.created_at) desc
$$;
revoke execute on function public.list_connections from public, anon;
grant execute on function public.list_connections to authenticated;

create or replace function public.list_collaboration_requests() returns table (
  id uuid, direction text, other_id uuid, other_name text, other_avatar text, other_role text, subject text, purpose text,
  campaign_details text, budget integer, message text, status text, response_note text, created_at timestamptz, responded_at timestamptz,
  conversation_id uuid)
language sql stable security definer set search_path = '' as $$
  select r.id, case when r.sender_id = auth.uid() then 'outgoing' else 'incoming' end, o.id,
         coalesce(cp.display_name, bp.business_name, o.full_name), coalesce(bp.logo_url, o.avatar_url), o.role,
         r.subject, r.purpose, r.campaign_details, r.budget, r.message, r.status, r.response_note, r.created_at, r.responded_at,
         (select cv.id from public.conversations cv where cv.user_a = least(r.sender_id, r.recipient_id) and cv.user_b = greatest(r.sender_id, r.recipient_id))
  from public.collaboration_requests r
  join public.profiles o on o.id = case when r.sender_id = auth.uid() then r.recipient_id else r.sender_id end
  left join public.creator_profiles cp on cp.user_id = o.id
  left join public.brand_profiles bp on bp.user_id = o.id
  where auth.uid() in (r.sender_id, r.recipient_id)
  order by r.status = 'pending' desc, r.created_at desc
$$;
revoke execute on function public.list_collaboration_requests from public, anon;
grant execute on function public.list_collaboration_requests to authenticated;

-- ---------------------------------------------------------------------
-- Admin analytics overview
-- ---------------------------------------------------------------------
create or replace function public.admin_analytics(p_from timestamptz default null, p_to timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := coalesce(p_from, now() - interval '30 days'); v_to timestamptz := coalesce(p_to, now() + interval '1 minute');
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'creators_total', (select count(*) from public.profiles where role = 'creator'),
    'creators_active', (select count(*) from public.profiles where role = 'creator' and status = 'active'
                          and last_active_at > now() - interval '30 days'),
    'brands_total', (select count(*) from public.profiles where role = 'brand'),
    'logins_success', (select count(*) from public.login_events where status = 'success' and occurred_at >= v_from and occurred_at < v_to),
    'logins_failure', (select count(*) from public.login_events where status = 'failure' and occurred_at >= v_from and occurred_at < v_to),
    'unique_login_users', (select count(distinct user_id) from public.login_events where status = 'success' and occurred_at >= v_from and occurred_at < v_to),
    'collaborations', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.collaboration_requests group by status) x),
    'connections', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.connections group by status) x),
    'conversations', (select count(*) from public.conversations),
    'messages', (select count(*) from public.messages where kind = 'text'),
    'from', v_from, 'to', v_to);
end $$;
revoke execute on function public.admin_analytics from public, anon;
grant execute on function public.admin_analytics to authenticated;

-- ---------------------------------------------------------------------
-- Realtime delivery for messages & notifications (Supabase only; skipped elsewhere)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications') then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end $$;
