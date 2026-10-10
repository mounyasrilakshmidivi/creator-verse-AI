-- =====================================================================
-- CreatorVerse AI: login alerts, message emails, email preferences & consent,
-- admin email campaigns, delivery tracking, and the login analytics report.
-- Additive: no tables or data are dropped. Requires the four earlier migrations.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Email preferences: new categories, marketing consent and one-click unsubscribe
-- ---------------------------------------------------------------------
alter table public.notification_prefs add column if not exists email_login boolean not null default true;     -- sign-in alerts
alter table public.notification_prefs add column if not exists email_messages boolean not null default true;  -- new-message emails
alter table public.notification_prefs add column if not exists email_marketing boolean not null default false; -- campaigns: opt-in only
alter table public.notification_prefs add column if not exists marketing_consent_at timestamptz;
alter table public.notification_prefs add column if not exists unsubscribe_token uuid not null default gen_random_uuid();
create unique index if not exists notification_prefs_unsub_idx on public.notification_prefs (unsubscribe_token);

-- Marketing consent: taken from the optional sign-up checkbox; timestamped whenever it's switched on.
create or replace function public.notification_prefs_consent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.email_marketing := coalesce(new.email_marketing, false) or coalesce((select (raw_user_meta_data ->> 'marketing_opt_in')::boolean from auth.users where id = new.user_id), false);
  end if;
  if new.email_marketing and (tg_op = 'INSERT' or not old.email_marketing) then new.marketing_consent_at := now(); end if;
  if tg_op = 'UPDATE' then new.unsubscribe_token := old.unsubscribe_token; end if;  -- token can't be replaced by the client
  return new;
end $$;
drop trigger if exists notification_prefs_consent on public.notification_prefs;
create trigger notification_prefs_consent before insert or update on public.notification_prefs
  for each row execute function public.notification_prefs_consent();

-- One-click unsubscribe from marketing (link in every campaign email; works without signing in)
create or replace function public.unsubscribe_marketing(p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  update public.notification_prefs set email_marketing = false, updated_at = now()
  where unsubscribe_token = p_token returning user_id into v_user;
  if v_user is null then return false; end if;
  -- don't send queued campaign emails to someone who just unsubscribed
  update public.email_outbox set status = 'skipped', last_error = 'unsubscribed'
  where user_id = v_user and campaign_id is not null and status in ('pending', 'failed');
  return true;
end $$;
revoke execute on function public.unsubscribe_marketing from public;
grant execute on function public.unsubscribe_marketing to anon, authenticated;

-- ---------------------------------------------------------------------
-- Outbox: campaign link and provider delivery states (delivered / bounced / complained via Resend webhooks)
-- ---------------------------------------------------------------------
alter table public.email_outbox add column if not exists campaign_id uuid;
alter table public.email_outbox add column if not exists delivered_at timestamptz;
alter table public.email_outbox drop constraint if exists email_outbox_status_check;
alter table public.email_outbox add constraint email_outbox_status_check
  check (status in ('pending', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'skipped'));
create index if not exists email_outbox_campaign_idx on public.email_outbox (campaign_id) where campaign_id is not null;
create index if not exists email_outbox_provider_idx on public.email_outbox (provider_message_id) where provider_message_id is not null;

-- Called by the resend-webhook Edge Function (signature-verified) with Resend's event type.
create or replace function public.record_email_event(p_provider_message_id text, p_event text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_row public.email_outbox;
begin
  select * into v_row from public.email_outbox where provider_message_id = p_provider_message_id;
  if v_row.id is null then return false; end if;
  if p_event = 'email.delivered' and v_row.status in ('sending', 'sent') then
    update public.email_outbox set status = 'delivered', delivered_at = now() where id = v_row.id;
  elsif p_event = 'email.bounced' then
    update public.email_outbox set status = 'bounced', last_error = 'bounced' where id = v_row.id;
    update public.notification_prefs set email_marketing = false where user_id = v_row.user_id;  -- stop campaigns to bad addresses
  elsif p_event = 'email.complained' then
    update public.email_outbox set status = 'complained', last_error = 'marked as spam' where id = v_row.id;
    update public.notification_prefs set email_marketing = false where user_id = v_row.user_id;
  end if;
  return true;
end $$;
revoke execute on function public.record_email_event from public, anon, authenticated;
grant execute on function public.record_email_event to service_role;

-- ---------------------------------------------------------------------
-- enqueue_event: same contract as before, plus new preference categories and richer welcome data
-- ---------------------------------------------------------------------
create or replace function public.enqueue_event(
  p_user uuid, p_kind text, p_title text, p_body text, p_link text,
  p_template text, p_data jsonb, p_dedupe text, p_category text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_prefs public.notification_prefs;
  v_send boolean := p_template is not null;
  v_data jsonb := coalesce(p_data, '{}');
begin
  if p_dedupe is not null and exists (select 1 from public.notifications where dedupe_key = p_dedupe) then
    return;  -- already handled (retries, duplicate webhooks)
  end if;
  if exists (select 1 from public.profiles where id = p_user) then
    insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
    values (p_user, p_kind, p_title, coalesce(p_body, ''), p_link, p_dedupe)
    on conflict (dedupe_key) do nothing;
  end if;
  if not v_send then return; end if;
  select * into v_prefs from public.notification_prefs where user_id = p_user;
  if p_category = 'activity' and v_prefs.email_activity is false then v_send := false; end if;
  if p_category = 'usage' and v_prefs.email_usage is false then v_send := false; end if;
  if p_category = 'billing' and v_prefs.email_billing is false then v_send := false; end if;
  if p_category = 'login' and v_prefs.email_login is false then v_send := false; end if;
  if p_category = 'messages' and v_prefs.email_messages is false then v_send := false; end if;
  if not v_send then return; end if;
  -- only verified addresses receive email
  select email into v_email from auth.users where id = p_user and email_confirmed_at is not null;
  if v_email is null then return; end if;
  if p_template = 'welcome' then
    v_data := v_data || (select jsonb_build_object('name', coalesce(nullif(p.full_name, ''), split_part(v_email, '@', 1)), 'role', p.role)
                         from public.profiles p where p.id = p_user);
  end if;
  insert into public.email_outbox (user_id, to_email, template, data, dedupe_key)
  values (p_user, v_email, p_template, v_data || jsonb_build_object('title', p_title, 'link', p_link), p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;
revoke execute on function public.enqueue_event from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Successful sign-in: login event (as before) + login alert email (user can turn it off)
-- ---------------------------------------------------------------------
create or replace function public.on_auth_user_signed_in() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_method text := coalesce(new.raw_app_meta_data ->> 'provider', 'password');
begin
  if new.last_sign_in_at is not null and new.last_sign_in_at is distinct from old.last_sign_in_at then
    insert into public.login_events (user_id, email, role, status, method, source, occurred_at)
    values (new.id, lower(new.email), (select role from public.profiles where id = new.id), 'success', v_method, 'auth', new.last_sign_in_at)
    returning event_uid into v_event;
    update public.profiles set last_active_at = new.last_sign_in_at where id = new.id;
    -- the automatic sign-in that completes email verification is covered by the welcome email
    if new.email_confirmed_at is not null and new.email_confirmed_at < new.last_sign_in_at - interval '2 minutes' then
      perform public.enqueue_event(new.id, 'login_alert', 'New sign-in to your account',
        format('Signed in on %s (UTC).', to_char(new.last_sign_in_at at time zone 'utc', 'DD Mon YYYY HH24:MI')), '#/account',
        'login_alert', jsonb_build_object('at', new.last_sign_in_at, 'method', v_method), 'login:' || v_event, 'login');
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- New message: in-app notification + email (throttled to one per conversation per hour; no message text in the email)
-- ---------------------------------------------------------------------
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
    perform public.enqueue_event(v_to, 'new_message', format('New message from %s', coalesce(nullif(v_name, ''), 'a member')),
      left(new.body, 120), '#/messages/m-' || new.conversation_id, 'new_message', jsonb_build_object('name', v_name),
      'msg:' || new.conversation_id || ':' || v_to || ':' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24'), 'messages');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Email campaigns (admin only; opted-in, verified, active users; one email per recipient)
-- ---------------------------------------------------------------------
create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles (id) on delete set null,
  audience text not null default 'all' check (audience in ('all', 'creator', 'brand')),
  subject text not null check (char_length(btrim(subject)) between 3 and 150),
  body text not null check (char_length(btrim(body)) between 10 and 10000),
  status text not null default 'draft' check (status in ('draft', 'queued', 'cancelled')),
  recipient_count integer not null default 0,
  test_sent_at timestamptz,
  created_at timestamptz not null default now(),
  launched_at timestamptz
);
alter table public.email_campaigns enable row level security;  -- no policies: admin functions only

create table if not exists public.email_campaign_recipients (
  campaign_id uuid not null references public.email_campaigns (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  outbox_id uuid references public.email_outbox (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);
alter table public.email_campaign_recipients enable row level security;

create or replace function public._campaign_audience(p_audience text)
returns table (user_id uuid, email text, unsubscribe_token uuid)
language sql stable security definer set search_path = '' as $$
  select p.id, u.email::text, n.unsubscribe_token
  from public.profiles p
  join auth.users u on u.id = p.id and u.email_confirmed_at is not null
  join public.notification_prefs n on n.user_id = p.id and n.email_marketing
  where p.status = 'active' and (p_audience = 'all' or p.role = p_audience)
$$;
revoke execute on function public._campaign_audience from public, anon, authenticated;

create or replace function public.admin_campaign_audience(p_audience text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_audience not in ('all', 'creator', 'brand') then raise exception 'invalid audience'; end if;
  return jsonb_build_object(
    'eligible', (select count(*) from public._campaign_audience(p_audience)),
    'registered', (select count(*) from public.profiles where p_audience = 'all' or role = p_audience),
    'not_opted_in', (select count(*) from public.profiles p left join public.notification_prefs n on n.user_id = p.id
                     where (p_audience = 'all' or p.role = p_audience) and not coalesce(n.email_marketing, false)));
end $$;
revoke execute on function public.admin_campaign_audience from public, anon;
grant execute on function public.admin_campaign_audience to authenticated;

create or replace function public.admin_save_campaign(p_id uuid, p_audience text, p_subject text, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.email_campaigns (created_by, audience, subject, body) values (auth.uid(), p_audience, btrim(p_subject), btrim(p_body))
    returning id into v_id;
  else
    update public.email_campaigns set audience = p_audience, subject = btrim(p_subject), body = btrim(p_body)
    where id = p_id and status = 'draft' returning id into v_id;
    if v_id is null then raise exception 'Only draft campaigns can be edited.'; end if;
  end if;
  return v_id;
end $$;
revoke execute on function public.admin_save_campaign from public, anon;
grant execute on function public.admin_save_campaign to authenticated;

create or replace function public.admin_send_campaign_test(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_c public.email_campaigns; v_email text;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into v_c from public.email_campaigns where id = p_id;
  if v_c.id is null then raise exception 'Campaign not found.'; end if;
  if (select count(*) from public.email_outbox where template = 'campaign' and user_id = auth.uid()
        and campaign_id is null and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Test email limit reached (10 per hour).';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.email_outbox (user_id, to_email, template, data, dedupe_key)
  values (auth.uid(), v_email, 'campaign', jsonb_build_object('subject', '[TEST] ' || v_c.subject, 'body', v_c.body, 'test', true),
          'camptest:' || p_id || ':' || extract(epoch from clock_timestamp()));
  update public.email_campaigns set test_sent_at = now() where id = p_id;
end $$;
revoke execute on function public.admin_send_campaign_test from public, anon;
grant execute on function public.admin_send_campaign_test to authenticated;

-- Launch requires typing SEND; each recipient gets their own email (no shared To/CC), once.
create or replace function public.admin_launch_campaign(p_id uuid, p_confirm text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_c public.email_campaigns; v_n integer;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_confirm is distinct from 'SEND' then raise exception 'Type SEND to confirm the campaign.'; end if;
  select * into v_c from public.email_campaigns where id = p_id for update;
  if v_c.id is null then raise exception 'Campaign not found.'; end if;
  if v_c.status <> 'draft' then raise exception 'This campaign was already launched.'; end if;
  with a as (select * from public._campaign_audience(v_c.audience)),
  o as (
    insert into public.email_outbox (user_id, to_email, template, data, dedupe_key, campaign_id)
    select a.user_id, a.email, 'campaign',
           jsonb_build_object('subject', v_c.subject, 'body', v_c.body, 'unsubscribe_token', a.unsubscribe_token),
           'camp:' || p_id || ':' || a.user_id, p_id
    from a
    on conflict (dedupe_key) do nothing
    returning id, user_id)
  insert into public.email_campaign_recipients (campaign_id, user_id, outbox_id)
  select p_id, o.user_id, o.id from o;
  get diagnostics v_n = row_count;
  update public.email_campaigns set status = 'queued', recipient_count = v_n, launched_at = now() where id = p_id;
  return v_n;
end $$;
revoke execute on function public.admin_launch_campaign from public, anon;
grant execute on function public.admin_launch_campaign to authenticated;

create or replace function public.admin_list_campaigns() returns table (
  id uuid, audience text, subject text, body text, status text, recipient_count integer, created_at timestamptz,
  launched_at timestamptz, test_sent_at timestamptz, queued bigint, sent bigint, delivered bigint, failed bigint, bounced bigint, skipped bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select c.id, c.audience, c.subject, c.body, c.status, c.recipient_count, c.created_at, c.launched_at, c.test_sent_at,
           count(o.id) filter (where o.status in ('pending', 'sending')),
           count(o.id) filter (where o.status = 'sent'),
           count(o.id) filter (where o.status = 'delivered'),
           count(o.id) filter (where o.status = 'failed'),
           count(o.id) filter (where o.status in ('bounced', 'complained')),
           count(o.id) filter (where o.status = 'skipped')
    from public.email_campaigns c left join public.email_outbox o on o.campaign_id = c.id
    group by c.id order by c.created_at desc;
end $$;
revoke execute on function public.admin_list_campaigns from public, anon;
grant execute on function public.admin_list_campaigns to authenticated;

-- ---------------------------------------------------------------------
-- Login analytics report: one call feeds the dashboard and all four Excel sheets
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('report_timezone', '"Asia/Kolkata"', 'Time zone used for dates in login analytics and the Excel report.')
on conflict (key) do nothing;

create or replace function public.admin_login_report(p_from timestamptz, p_to timestamptz, p_role text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := coalesce((select value #>> '{}' from public.app_settings where key = 'report_timezone'), 'UTC');
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_len interval;
  v_prev_from timestamptz;
  v_first_event timestamptz;
  v_result jsonb;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if v_to <= v_from then raise exception 'The end date must be after the start date.'; end if;
  v_len := v_to - v_from;
  v_prev_from := v_from - v_len;
  select min(occurred_at) into v_first_event from public.login_events;

  with users as (
    select p.id, p.full_name, p.role, p.created_at, u.email::text email, u.last_sign_in_at,
           greatest(p.last_active_at, u.last_sign_in_at) last_activity
    from public.profiles p join auth.users u on u.id = p.id
    where p_role is null or p.role = p_role),
  ev as (
    select e.*, coalesce(pr.role, e.role) eff_role from public.login_events e left join public.profiles pr on pr.id = e.user_id
    where (p_role is null or coalesce(pr.role, e.role) = p_role)),
  cur as (select * from ev where occurred_at >= v_from and occurred_at < v_to),
  prev as (select * from ev where occurred_at >= v_prev_from and occurred_at < v_from),
  days as (select generate_series((v_from at time zone v_tz)::date, ((v_to - interval '1 second') at time zone v_tz)::date, interval '1 day')::date d)
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'timezone', v_tz, 'role', p_role,
    'history_available_from', v_first_event,
    'previous_period_complete', v_first_event is not null and v_first_event <= v_prev_from,
    'summary', jsonb_build_object(
      'users_total', (select count(*) from users),
      'creators', (select count(*) from users where role = 'creator'),
      'brands', (select count(*) from users where role = 'brand'),
      'no_role', (select count(*) from users where role is null),
      'successful_logins', (select count(*) from cur where status = 'success'),
      'failed_logins', (select count(*) from cur where status = 'failure'),
      'unique_users', (select count(distinct user_id) from cur where status = 'success'),
      'never_logged_in', (select count(*) from users u where u.last_sign_in_at is null
                           and not exists (select 1 from public.login_events e where e.user_id = u.id and e.status = 'success')),
      'ever_logged_in', (select count(*) from users u where u.last_sign_in_at is not null
                           or exists (select 1 from public.login_events e where e.user_id = u.id and e.status = 'success')),
      'new_registrations', (select count(*) from users where created_at >= v_from and created_at < v_to)),
    'previous', jsonb_build_object(
      'from', v_prev_from, 'to', v_from,
      'successful_logins', (select count(*) from prev where status = 'success'),
      'failed_logins', (select count(*) from prev where status = 'failure'),
      'unique_users', (select count(distinct user_id) from prev where status = 'success'),
      'new_registrations', (select count(*) from users where created_at >= v_prev_from and created_at < v_from)),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.d,
        'success', (select count(*) from cur where status = 'success' and (occurred_at at time zone v_tz)::date = d.d),
        'failure', (select count(*) from cur where status = 'failure' and (occurred_at at time zone v_tz)::date = d.d),
        'active_users', (select count(distinct user_id) from cur where status = 'success' and (occurred_at at time zone v_tz)::date = d.d),
        'registrations', (select count(*) from users where (created_at at time zone v_tz)::date = d.d)) order by d.d), '[]') from days d),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object(
        'role', r.role,
        'registered', (select count(*) from users where role = r.role),
        'success', (select count(*) from cur where status = 'success' and eff_role = r.role),
        'failure', (select count(*) from cur where status = 'failure' and eff_role = r.role),
        'unique_users', (select count(distinct user_id) from cur where status = 'success' and eff_role = r.role)) order by r.role), '[]')
      from (values ('brand'), ('creator')) r(role) where p_role is null or r.role = p_role),
    'users', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', u.id, 'name', u.full_name, 'email', u.email, 'role', u.role, 'registered_at', u.created_at,
        'last_login', greatest(u.last_sign_in_at, (select max(occurred_at) from public.login_events e where e.user_id = u.id and e.status = 'success')),
        'last_activity', u.last_activity,
        'logins_in_period', (select count(*) from cur where cur.user_id = u.id and status = 'success'),
        'failed_in_period', (select count(*) from cur where cur.user_id = u.id and status = 'failure')) order by u.created_at), '[]') from users u),
    'collaborations', jsonb_build_object(
      'sent', (select count(*) from public.collaboration_requests where created_at >= v_from and created_at < v_to),
      'accepted', (select count(*) from public.collaboration_requests where status in ('accepted', 'completed') and responded_at >= v_from and responded_at < v_to),
      'declined', (select count(*) from public.collaboration_requests where status = 'declined' and responded_at >= v_from and responded_at < v_to)))
  into v_result;
  return v_result;
end $$;
revoke execute on function public.admin_login_report from public, anon;
grant execute on function public.admin_login_report to authenticated;
