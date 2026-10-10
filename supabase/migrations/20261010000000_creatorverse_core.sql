-- =====================================================================
-- CreatorVerse AI: core schema, Row Level Security, quotas, notifications
-- Apply with:  npx supabase db push   (or paste into Supabase SQL Editor)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Reference values
-- ---------------------------------------------------------------------
create or replace function public.valid_niches() returns text[]
language sql immutable as $$
  select array['fashion','tech','food','fitness','travel','beauty','gaming','education','music','photography']
$$;

create or replace function public.valid_platforms() returns text[]
language sql immutable as $$
  select array['instagram','youtube','x','linkedin','twitch']
$$;

-- ---------------------------------------------------------------------
-- Admins (only writable with the service role / SQL editor)
-- ---------------------------------------------------------------------
create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
create policy "admins can see own admin row" on public.app_admins
  for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  role text check (role in ('brand', 'creator')),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- A role can be chosen once; only admins may change it afterwards.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role is not null and new.role is distinct from old.role and not public.is_admin() then
    raise exception 'role_locked: account type cannot be changed' using errcode = '42501';
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

create table public.brand_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  business_name text not null check (char_length(business_name) between 2 and 120),
  industry text not null check (char_length(industry) between 2 and 80),
  description text not null default '' check (char_length(description) <= 2000),
  goals text[] not null default '{}',
  target_audience text not null default '' check (char_length(target_audience) <= 300),
  platforms text[] not null default '{}' check (platforms <@ public.valid_platforms()),
  budget_bracket text not null default 'any' check (budget_bracket in ('any','u5','5-15','15-30','30+')),
  updated_at timestamptz not null default now()
);
alter table public.brand_profiles enable row level security;
create policy "brand profile owner" on public.brand_profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.creator_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 80),
  bio text not null default '' check (char_length(bio) <= 2000),
  niches text[] not null default '{}' check (niches <@ public.valid_niches() and cardinality(niches) <= 3),
  languages text[] not null default '{}' check (cardinality(languages) <= 10),
  city text not null default '' check (char_length(city) <= 80),
  price_from integer check (price_from is null or price_from between 0 and 10000000),
  packages text not null default '' check (char_length(packages) <= 3000),
  published boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.creator_profiles enable row level security;
create policy "creator profile owner" on public.creator_profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "published creator profiles are visible to members" on public.creator_profiles
  for select to authenticated using (published);

create table public.creator_social_links (
  user_id uuid not null references public.creator_profiles (user_id) on delete cascade,
  platform text not null check (platform = any (public.valid_platforms())),
  url text not null check (url ~ '^https://[^\s]+\.[^\s]+$' and char_length(url) <= 300),
  primary key (user_id, platform)
);
alter table public.creator_social_links enable row level security;
create policy "social links owner" on public.creator_social_links for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "social links of published creators" on public.creator_social_links for select to authenticated
  using (exists (select 1 from public.creator_profiles c where c.user_id = creator_social_links.user_id and c.published));

-- ---------------------------------------------------------------------
-- Plans, limits and settings (admin-configurable, publicly readable)
-- ---------------------------------------------------------------------
create table public.plans (
  id text primary key check (id ~ '^[a-z_]+$'),
  tier text not null check (tier in ('free', 'premium')),
  name text not null,
  description text not null default '',
  price_inr integer not null default 0 check (price_inr >= 0),
  billing_interval text check (billing_interval in ('month', 'year')),
  razorpay_plan_id text,
  features text[] not null default '{}',
  is_active boolean not null default true,
  sort_order integer not null default 0
);
alter table public.plans enable row level security;
create policy "plans are public" on public.plans for select to anon, authenticated using (true);
create policy "admins manage plans" on public.plans for update to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.plan_limits (
  tier text not null check (tier in ('free', 'premium')),
  feature text not null check (feature in ('profile_view', 'search', 'ai_match', 'campaign', 'saved_creator')),
  limit_value integer check (limit_value is null or limit_value >= 0),  -- null = unlimited
  period text not null check (period in ('day', 'month', 'lifetime')),
  primary key (tier, feature)
);
alter table public.plan_limits enable row level security;
create policy "limits are public" on public.plan_limits for select to anon, authenticated using (true);
create policy "admins manage limits" on public.plan_limits for update to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text not null default ''
);
alter table public.app_settings enable row level security;
create policy "settings are public" on public.app_settings for select to anon, authenticated using (true);
create policy "admins manage settings" on public.app_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Subscriptions and payment events (written only by Edge Functions with the service role)
-- ---------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null default 'razorpay' check (provider in ('razorpay')),
  provider_subscription_id text not null unique,
  plan_id text not null references public.plans (id),
  status text not null check (status in ('created','authenticated','active','pending','halted','cancelled','completed','expired')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_user_idx on public.subscriptions (user_id);
alter table public.subscriptions enable row level security;
create policy "read own subscriptions" on public.subscriptions for select to authenticated using (user_id = auth.uid());

create table public.payment_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, event_id)
);
alter table public.payment_events enable row level security;  -- no policies: service role only

-- ---------------------------------------------------------------------
-- Usage counters and quota logic
-- ---------------------------------------------------------------------
create table public.usage_counters (
  user_id uuid not null references public.profiles (id) on delete cascade,
  feature text not null,
  period_start date not null,
  used integer not null default 0 check (used >= 0),
  primary key (user_id, feature, period_start)
);
alter table public.usage_counters enable row level security;
create policy "read own usage" on public.usage_counters for select to authenticated using (user_id = auth.uid());

create or replace function public.user_tier(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when exists (
    select 1 from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    where s.user_id = p_user and p.tier = 'premium'
      and s.status in ('active', 'pending')            -- 'pending' = renewal retry grace period
      and (s.current_period_end is null or s.current_period_end > now())
  ) then 'premium' else 'free' end
$$;

revoke execute on function public.user_tier from public, anon, authenticated;

create or replace function public.period_start(p_period text) returns date
language sql stable as $$
  select case p_period
    when 'day' then (now() at time zone 'utc')::date
    when 'month' then date_trunc('month', now() at time zone 'utc')::date
    else date '1970-01-01' end
$$;

create or replace function public.period_end(p_period text) returns timestamptz
language sql stable as $$
  select case p_period
    when 'day' then ((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc'
    when 'month' then (date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc'
    else null end
$$;

-- ---------------------------------------------------------------------
-- Notifications (in-app) and the email outbox
-- ---------------------------------------------------------------------
create table public.notification_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email_activity boolean not null default true,   -- campaigns, applications, requests
  email_usage boolean not null default true,      -- plan usage warnings
  email_billing boolean not null default true,    -- renewal reminders (payment failures and activation are always sent)
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
create policy "own notification prefs" on public.notification_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  link text,
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
create policy "read own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "mark own notifications read" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.notifications_guard() returns trigger
language plpgsql as $$
begin
  -- users may only toggle read_at
  if (new.user_id, new.kind, new.title, new.body, new.link, new.dedupe_key, new.created_at)
     is distinct from (old.user_id, old.kind, old.title, old.body, old.link, old.dedupe_key, old.created_at) then
    raise exception 'only read_at can be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger notifications_guard before update on public.notifications for each row execute function public.notifications_guard();

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  to_email text not null,
  template text not null,
  data jsonb not null default '{}',
  dedupe_key text unique,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  attempts integer not null default 0,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_pending_idx on public.email_outbox (created_at) where status in ('pending', 'failed');
alter table public.email_outbox enable row level security;  -- no policies: service role only

-- Records an in-app notification and (if allowed) queues an email. Not callable by clients.
-- p_category: 'security' and 'billing_critical' ignore preferences; 'activity', 'usage', 'billing' respect them.
create or replace function public.enqueue_event(
  p_user uuid, p_kind text, p_title text, p_body text, p_link text,
  p_template text, p_data jsonb, p_dedupe text, p_category text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_prefs public.notification_prefs;
  v_send boolean := p_template is not null;
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
  if not v_send then return; end if;
  select email into v_email from auth.users where id = p_user;
  if v_email is null then return; end if;
  insert into public.email_outbox (user_id, to_email, template, data, dedupe_key)
  values (p_user, v_email, p_template, coalesce(p_data, '{}') || jsonb_build_object('title', p_title, 'link', p_link), p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;
revoke execute on function public.enqueue_event from public, anon, authenticated;

-- Internal quota consumer. Returns a JSON status; never raises for "limit reached".
create or replace function public._consume_quota(p_user uuid, p_feature text, p_amount integer default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tier text := public.user_tier(p_user);
  v_limit public.plan_limits;
  v_start date;
  v_used integer;
  v_warn numeric := coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'usage_warning_ratio'), 0.8);
  v_threshold integer;
  v_label text;
begin
  if p_amount < 1 or p_amount > 100 then raise exception 'invalid amount'; end if;
  select * into v_limit from public.plan_limits where tier = v_tier and feature = p_feature;
  if not found then raise exception 'unknown feature %', p_feature; end if;
  v_start := public.period_start(v_limit.period);

  insert into public.usage_counters as u (user_id, feature, period_start, used)
  values (p_user, p_feature, v_start, 0)
  on conflict (user_id, feature, period_start) do nothing;

  update public.usage_counters as u set used = u.used + p_amount
  where u.user_id = p_user and u.feature = p_feature and u.period_start = v_start
    and (v_limit.limit_value is null or u.used + p_amount <= v_limit.limit_value)
  returning u.used into v_used;

  if v_used is null then
    select used into v_used from public.usage_counters where user_id = p_user and feature = p_feature and period_start = v_start;
    return jsonb_build_object('allowed', false, 'feature', p_feature, 'tier', v_tier, 'used', v_used,
      'limit', v_limit.limit_value, 'period', v_limit.period, 'resets_at', public.period_end(v_limit.period));
  end if;

  if v_limit.limit_value is not null then
    v_label := case p_feature when 'profile_view' then 'creator profile views' when 'search' then 'searches'
      when 'ai_match' then 'AI matching requests' when 'campaign' then 'campaigns' else 'saved creators' end;
    v_threshold := ceil(v_limit.limit_value * v_warn);
    if v_used >= v_limit.limit_value then
      perform public.enqueue_event(p_user, 'limit_reached', format('You''ve used all your %s', v_label),
        format('Your %s plan includes %s %s per %s. Upgrade to Premium for more.', v_tier, v_limit.limit_value, v_label, v_limit.period),
        '#/pricing', 'usage_limit_reached',
        jsonb_build_object('feature', v_label, 'limit', v_limit.limit_value, 'period', v_limit.period),
        format('limit:%s:%s:%s', p_user, p_feature, v_start), 'usage');
    elsif v_used >= v_threshold and v_used - p_amount < v_threshold then
      perform public.enqueue_event(p_user, 'usage_warning', format('You''ve used %s of %s %s', v_used, v_limit.limit_value, v_label),
        'You are close to your plan limit for this period.', '#/billing', 'usage_warning',
        jsonb_build_object('feature', v_label, 'used', v_used, 'limit', v_limit.limit_value, 'period', v_limit.period),
        format('warn:%s:%s:%s', p_user, p_feature, v_start), 'usage');
    end if;
  end if;

  return jsonb_build_object('allowed', true, 'feature', p_feature, 'tier', v_tier, 'used', v_used,
    'limit', v_limit.limit_value, 'period', v_limit.period, 'resets_at', public.period_end(v_limit.period),
    'remaining', case when v_limit.limit_value is null then null else v_limit.limit_value - v_used end);
end $$;
revoke execute on function public._consume_quota from public, anon, authenticated;

-- Client entry point for metered actions that happen in the browser (profile views, searches, AI matches).
create or replace function public.consume_quota(p_feature text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_feature not in ('profile_view', 'search', 'ai_match') then
    raise exception 'feature % is enforced by the database, not consumable directly', p_feature;
  end if;
  return public._consume_quota(auth.uid(), p_feature, 1);
end $$;
revoke execute on function public.consume_quota from public, anon;
grant execute on function public.consume_quota to authenticated;



-- ---------------------------------------------------------------------
-- Saved creators (limit = concurrent saved items)
-- ---------------------------------------------------------------------
create table public.saved_creators (
  user_id uuid not null references public.profiles (id) on delete cascade,
  creator_ref text not null check (creator_ref ~ '^[a-z0-9_-]{2,64}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, creator_ref)
);
alter table public.saved_creators enable row level security;
create policy "own saved creators" on public.saved_creators for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.saved_creators_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_limit integer;
begin
  select limit_value into v_limit from public.plan_limits where tier = public.user_tier(new.user_id) and feature = 'saved_creator';
  if v_limit is not null and (select count(*) from public.saved_creators where user_id = new.user_id) >= v_limit then
    raise exception 'quota_exceeded:saved_creator' using errcode = 'P0001', hint = v_limit::text;
  end if;
  return new;
end $$;
create trigger saved_creators_limit before insert on public.saved_creators for each row execute function public.saved_creators_limit();

-- Current plan and usage for the signed-in user (dashboard / billing page).
create or replace function public.my_plan() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tier', public.user_tier(auth.uid()),
    'is_admin', public.is_admin(),
    'subscription', (select to_jsonb(s) - 'user_id' from public.subscriptions s
                     where s.user_id = auth.uid() order by s.created_at desc limit 1),
    'usage', (select jsonb_agg(jsonb_build_object(
                'feature', l.feature, 'limit', l.limit_value, 'period', l.period,
                'resets_at', public.period_end(l.period),
                'used', case when l.feature = 'saved_creator'
                          then (select count(*) from public.saved_creators sc where sc.user_id = auth.uid())
                          else coalesce((select u.used from public.usage_counters u where u.user_id = auth.uid()
                                         and u.feature = l.feature and u.period_start = public.period_start(l.period)), 0) end)
              order by l.feature)
              from public.plan_limits l where l.tier = public.user_tier(auth.uid()))
  )
  where auth.uid() is not null
$$;
revoke execute on function public.my_plan from public, anon;
grant execute on function public.my_plan to authenticated;

-- ---------------------------------------------------------------------
-- Campaigns, applications and collaboration requests
-- ---------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  brand_name text not null default '',
  title text not null check (char_length(title) between 5 and 140),
  brief text not null check (char_length(brief) between 30 and 4000),
  category text not null check (category = any (public.valid_niches())),
  budget_min integer not null check (budget_min >= 500),
  budget_max integer not null check (budget_max <= 100000000),
  platforms text[] not null check (cardinality(platforms) >= 1 and platforms <@ public.valid_platforms()),
  deliverables text[] not null check (cardinality(deliverables) between 1 and 20),
  deadline date not null,
  status text not null default 'open' check (status in ('draft', 'open', 'in_review', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (budget_max >= budget_min)
);
create index campaigns_owner_idx on public.campaigns (owner_id);
alter table public.campaigns enable row level security;
create policy "owners manage campaigns" on public.campaigns for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "members see open campaigns" on public.campaigns for select to authenticated
  using (status in ('open', 'in_review'));

create or replace function public.campaigns_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_q jsonb;
begin
  if (select role from public.profiles where id = new.owner_id) is distinct from 'brand' then
    raise exception 'only brand accounts can create campaigns' using errcode = '42501';
  end if;
  if new.deadline < current_date then raise exception 'deadline must be in the future'; end if;
  new.brand_name := coalesce((select business_name from public.brand_profiles where user_id = new.owner_id),
                             (select full_name from public.profiles where id = new.owner_id), '');
  v_q := public._consume_quota(new.owner_id, 'campaign', 1);
  if not (v_q ->> 'allowed')::boolean then
    raise exception 'quota_exceeded:campaign' using errcode = 'P0001', hint = coalesce(v_q ->> 'limit', '');
  end if;
  new.created_at := now();
  return new;
end $$;
create trigger campaigns_before_insert before insert on public.campaigns for each row execute function public.campaigns_before_insert();

create or replace function public.campaigns_before_update() returns trigger
language plpgsql as $$
begin
  new.owner_id := old.owner_id; new.brand_name := old.brand_name; new.created_at := old.created_at; new.updated_at := now();
  return new;
end $$;
create trigger campaigns_before_update before update on public.campaigns for each row execute function public.campaigns_before_update();

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  creator_id uuid not null references public.profiles (id) on delete cascade,
  creator_name text not null default '',
  rate integer not null check (rate between 500 and 100000000),
  pitch text not null check (char_length(pitch) between 30 and 3000),
  status text not null default 'pending' check (status in ('pending','shortlisted','accepted','declined','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, creator_id)
);
alter table public.applications enable row level security;
create policy "creators see own applications" on public.applications for select to authenticated using (creator_id = auth.uid());
create policy "creators apply" on public.applications for insert to authenticated with check (creator_id = auth.uid());
create policy "creators update own applications" on public.applications for update to authenticated
  using (creator_id = auth.uid()) with check (creator_id = auth.uid());
create policy "campaign owners see applications" on public.applications for select to authenticated
  using (exists (select 1 from public.campaigns c where c.id = campaign_id and c.owner_id = auth.uid()));
create policy "campaign owners update applications" on public.applications for update to authenticated
  using (exists (select 1 from public.campaigns c where c.id = campaign_id and c.owner_id = auth.uid()));

create or replace function public.applications_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_c public.campaigns;
begin
  if (select role from public.profiles where id = new.creator_id) is distinct from 'creator' then
    raise exception 'only creator accounts can apply' using errcode = '42501';
  end if;
  select * into v_c from public.campaigns where id = new.campaign_id;
  if v_c.id is null or v_c.status <> 'open' then raise exception 'campaign is not open for applications'; end if;
  if v_c.owner_id = new.creator_id then raise exception 'cannot apply to your own campaign'; end if;
  new.status := 'pending';
  new.creator_name := coalesce((select display_name from public.creator_profiles where user_id = new.creator_id),
                               (select full_name from public.profiles where id = new.creator_id), 'Creator');
  return new;
end $$;
create trigger applications_before_insert before insert on public.applications for each row execute function public.applications_before_insert();

-- Creators may edit their pending application or withdraw; owners may only change status.
create or replace function public.applications_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := (select owner_id from public.campaigns where id = old.campaign_id);
begin
  new.id := old.id; new.campaign_id := old.campaign_id; new.creator_id := old.creator_id;
  new.creator_name := old.creator_name; new.created_at := old.created_at; new.updated_at := now();
  if auth.uid() = old.creator_id then
    if old.status <> 'pending' and (new.rate, new.pitch) is distinct from (old.rate, old.pitch) then
      raise exception 'application can only be edited while pending';
    end if;
    if new.status is distinct from old.status and new.status <> 'withdrawn' then
      raise exception 'creators can only withdraw' using errcode = '42501';
    end if;
  elsif auth.uid() = v_owner then
    if (new.rate, new.pitch) is distinct from (old.rate, old.pitch) then
      raise exception 'brands can only change the status' using errcode = '42501';
    end if;
    if new.status not in ('pending', 'shortlisted', 'accepted', 'declined') then
      raise exception 'invalid status for brand' using errcode = '42501';
    end if;
  elsif auth.uid() is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger applications_before_update before update on public.applications for each row execute function public.applications_before_update();

create table public.collab_requests (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.profiles (id) on delete cascade,
  creator_ref text not null check (creator_ref ~ '^[a-z0-9_-]{2,64}$'),
  creator_name text not null check (char_length(creator_name) between 1 and 120),
  campaign_id uuid references public.campaigns (id) on delete set null,
  budget integer not null check (budget between 500 and 100000000),
  deliverables text not null check (char_length(deliverables) between 3 and 500),
  go_live date not null,
  message text not null check (char_length(message) between 20 and 3000),
  status text not null default 'sent' check (status in ('sent', 'withdrawn')),
  created_at timestamptz not null default now()
);
alter table public.collab_requests enable row level security;
create policy "brands manage own requests" on public.collab_requests for all to authenticated
  using (brand_id = auth.uid()) with check (brand_id = auth.uid());

create or replace function public.collab_requests_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select role from public.profiles where id = new.brand_id) is distinct from 'brand' then
    raise exception 'only brand accounts can send requests' using errcode = '42501';
  end if;
  if new.campaign_id is not null and not exists (select 1 from public.campaigns where id = new.campaign_id and owner_id = new.brand_id) then
    raise exception 'campaign does not belong to you' using errcode = '42501';
  end if;
  new.status := 'sent';
  return new;
end $$;
create trigger collab_requests_before_insert before insert on public.collab_requests for each row execute function public.collab_requests_before_insert();

-- ---------------------------------------------------------------------
-- Event triggers: confirmed database changes -> notification + email outbox
-- ---------------------------------------------------------------------
create or replace function public.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- account type chosen on the sign-up form (brand/creator are not privileged roles); admin is never set here
  insert into public.profiles (id, full_name, role)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 120),
          case when new.raw_user_meta_data ->> 'account_type' in ('brand', 'creator') then new.raw_user_meta_data ->> 'account_type' end)
  on conflict (id) do nothing;
  insert into public.notification_prefs (user_id) values (new.id) on conflict do nothing;
  if new.email_confirmed_at is not null then  -- e.g. Google sign-in: already verified
    perform public.enqueue_event(new.id, 'welcome', 'Welcome to CreatorVerse AI', 'Your account is ready.', '#/dashboard',
      'welcome', '{}', 'welcome:' || new.id, 'security');
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.on_auth_user_created();

create or replace function public.on_auth_user_updated() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform public.enqueue_event(new.id, 'welcome', 'Welcome to CreatorVerse AI', 'Your email is verified and your account is ready.',
      '#/dashboard', 'welcome', '{}', 'welcome:' || new.id, 'security');
  end if;
  if old.email is distinct from new.email and old.email is not null then
    perform public.enqueue_event(new.id, 'security', 'Your sign-in email was changed',
      'If you did not make this change, reset your password and contact support.', '#/account',
      'security_email_changed', '{}', 'email-changed:' || new.id || ':' || extract(epoch from now())::bigint, 'security');
  end if;
  if old.encrypted_password is distinct from new.encrypted_password and old.encrypted_password is not null then
    perform public.enqueue_event(new.id, 'security', 'Your password was changed',
      'If you did not make this change, reset your password immediately.', '#/account',
      'security_password_changed', '{}', 'password-changed:' || new.id || ':' || extract(epoch from now())::bigint, 'security');
  end if;
  return new;
end $$;
create trigger on_auth_user_updated after update of email_confirmed_at, email, encrypted_password on auth.users
  for each row execute function public.on_auth_user_updated();

create or replace function public.on_creator_profile_saved() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.published and (tg_op = 'INSERT' or not old.published) then
    perform public.enqueue_event(new.user_id, 'profile_published', 'Your creator profile is live',
      'Brands on CreatorVerse AI can now find your profile.', '#/account',
      'creator_profile_published', jsonb_build_object('name', new.display_name), 'profile-published:' || new.user_id, 'activity');
  end if;
  return new;
end $$;
create trigger on_creator_profile_saved after insert or update of published on public.creator_profiles
  for each row execute function public.on_creator_profile_saved();

create or replace function public.on_campaign_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.enqueue_event(new.owner_id, 'campaign_created', format('Campaign "%s" is live', new.title),
    'Creators can now discover and apply to your campaign.', '#/campaigns',
    'campaign_created', jsonb_build_object('campaign', new.title, 'deadline', new.deadline),
    'campaign-created:' || new.id, 'activity');
  return new;
end $$;
create trigger on_campaign_created after insert on public.campaigns for each row execute function public.on_campaign_created();

create or replace function public.on_application_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_c public.campaigns;
begin
  select * into v_c from public.campaigns where id = new.campaign_id;
  if tg_op = 'INSERT' then
    perform public.enqueue_event(v_c.owner_id, 'application_received', format('New application for "%s"', v_c.title),
      format('%s applied to your campaign.', new.creator_name), '#/campaigns',
      'application_received', jsonb_build_object('campaign', v_c.title, 'creator', new.creator_name),
      'app-received:' || new.id, 'activity');
    perform public.enqueue_event(new.creator_id, 'application_sent', format('Application sent to %s', v_c.brand_name),
      format('You applied to "%s".', v_c.title), '#/campaigns', null, null, 'app-sent:' || new.id, 'activity');
  elsif new.status is distinct from old.status and new.status in ('shortlisted', 'accepted', 'declined') then
    perform public.enqueue_event(new.creator_id, 'application_update', format('Your application was %s', new.status),
      format('%s updated your application for "%s".', v_c.brand_name, v_c.title), '#/campaigns',
      'application_update', jsonb_build_object('campaign', v_c.title, 'brand', v_c.brand_name, 'status', new.status),
      'app-status:' || new.id || ':' || new.status, 'activity');
  end if;
  return new;
end $$;
create trigger on_application_change after insert or update of status on public.applications
  for each row execute function public.on_application_change();

create or replace function public.on_collab_request_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.enqueue_event(new.brand_id, 'request_sent', format('Collaboration request sent to %s', new.creator_name),
    'We saved your request. Sample creators do not receive real messages in this demo directory.', '#/campaigns',
    'collab_request_sent', jsonb_build_object('creator', new.creator_name, 'budget', new.budget, 'go_live', new.go_live),
    'request:' || new.id, 'activity');
  return new;
end $$;
create trigger on_collab_request_created after insert on public.collab_requests for each row execute function public.on_collab_request_created();

create or replace function public.on_subscription_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_plan public.plans;
begin
  select * into v_plan from public.plans where id = new.plan_id;
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    perform public.enqueue_event(new.user_id, 'subscription_active', 'Premium is active',
      format('Your %s subscription is active. Thank you!', v_plan.name), '#/billing',
      'subscription_activated', jsonb_build_object('plan', v_plan.name, 'period_end', new.current_period_end),
      'sub-active:' || new.provider_subscription_id, 'billing_critical');
  elsif tg_op = 'UPDATE' and new.status = 'active' and old.status = 'active'
        and new.current_period_end > old.current_period_end then
    perform public.enqueue_event(new.user_id, 'subscription_renewed', 'Premium renewed',
      format('Your %s subscription renewed until %s.', v_plan.name, to_char(new.current_period_end, 'DD Mon YYYY')), '#/billing',
      'subscription_renewed', jsonb_build_object('plan', v_plan.name, 'period_end', new.current_period_end),
      'sub-renewed:' || new.provider_subscription_id || ':' || extract(epoch from new.current_period_end)::bigint, 'billing');
  end if;
  if tg_op = 'UPDATE' and new.cancel_at_period_end and not old.cancel_at_period_end then
    perform public.enqueue_event(new.user_id, 'subscription_cancel_scheduled', 'Premium will not renew',
      format('You keep Premium until %s.', coalesce(to_char(new.current_period_end, 'DD Mon YYYY'), 'the end of the period')), '#/billing',
      'subscription_cancel_scheduled', jsonb_build_object('plan', v_plan.name, 'period_end', new.current_period_end),
      'sub-cancel-sched:' || new.provider_subscription_id, 'billing_critical');
  end if;
  if tg_op = 'UPDATE' and new.status in ('cancelled', 'completed', 'expired', 'halted') and old.status is distinct from new.status then
    perform public.enqueue_event(new.user_id, 'subscription_ended',
      case new.status when 'halted' then 'Premium paused: payment failed' else 'Premium has ended' end,
      case new.status when 'halted' then 'We could not renew your subscription. Update your payment method to restore Premium.'
                      else 'Your account is back on the Free plan. Your data is safe.' end, '#/billing',
      'subscription_ended', jsonb_build_object('plan', v_plan.name, 'status', new.status),
      'sub-ended:' || new.provider_subscription_id || ':' || new.status, 'billing_critical');
  end if;
  return new;
end $$;
create trigger on_subscription_change after insert or update on public.subscriptions
  for each row execute function public.on_subscription_change();

-- Marks subscriptions whose paid period has passed (run daily with pg_cron, see SETUP.md).
create or replace function public.expire_subscriptions() returns integer
language sql security definer set search_path = '' as $$
  with x as (
    update public.subscriptions set status = 'expired', updated_at = now()
    where status in ('active', 'pending') and current_period_end is not null
      and current_period_end < now() - interval '3 days'
    returning 1)
  select count(*)::integer from x
$$;
revoke execute on function public.expire_subscriptions from public, anon, authenticated;
grant execute on function public.expire_subscriptions to service_role;

-- ---------------------------------------------------------------------
-- Seed data: SAMPLE prices (change in the Admin page or here)
-- ---------------------------------------------------------------------
insert into public.plans (id, tier, name, description, price_inr, billing_interval, features, sort_order) values
  ('free', 'free', 'Free', 'For brands and creators getting started.', 0, null,
   array['10 creator profile views / month', '5 searches / month', '3 AI matching requests / month', '1 campaign / month', '5 saved creators'], 0),
  ('premium_monthly', 'premium', 'Premium Monthly', 'Higher limits and advanced filters, billed monthly.', 999, 'month',
   array['Unlimited creator profile views', '500 searches / month', '100 AI matching requests / month', '20 campaigns / month', '200 saved creators', 'Advanced filters (audience size, rating)'], 1),
  ('premium_yearly', 'premium', 'Premium Yearly', 'Everything in Premium Monthly, two months free.', 9990, 'year',
   array['Unlimited creator profile views', '500 searches / month', '100 AI matching requests / month', '20 campaigns / month', '200 saved creators', 'Advanced filters (audience size, rating)'], 2);

insert into public.plan_limits (tier, feature, limit_value, period) values
  ('free', 'profile_view', 10, 'month'), ('free', 'search', 5, 'month'), ('free', 'ai_match', 3, 'month'),
  ('free', 'campaign', 1, 'month'), ('free', 'saved_creator', 5, 'lifetime'),
  ('premium', 'profile_view', null, 'month'), ('premium', 'search', 500, 'month'), ('premium', 'ai_match', 100, 'month'),
  ('premium', 'campaign', 20, 'month'), ('premium', 'saved_creator', 200, 'lifetime');

insert into public.app_settings (key, value, description) values
  ('usage_warning_ratio', '0.8', 'Send a usage warning when this share of a limit is used (0-1).'),
  ('advanced_filters_premium_only', 'true', 'Audience-size and rating filters require Premium.'),
  ('payments_enabled', 'true', 'Show checkout buttons on the pricing page.'),
  ('prices_are_samples', 'true', 'Label prices as samples on the pricing page.');
