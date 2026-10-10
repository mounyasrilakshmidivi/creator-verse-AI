-- =====================================================================
-- CreatorVerse AI: account approval & admin user management (additive)
-- Requires 20261010000000_creatorverse_core.sql and 20261010000100_email_dispatch.sql.
-- Nothing is dropped. Existing users keep working: status defaults to 'active'.
-- =====================================================================

alter table public.profiles add column if not exists status text not null default 'active'
  check (status in ('pending', 'active', 'rejected', 'suspended'));
alter table public.profiles add column if not exists status_reason text check (status_reason is null or char_length(status_reason) <= 500);
alter table public.profiles add column if not exists status_changed_at timestamptz;

insert into public.app_settings (key, value, description) values
  ('require_account_approval', 'false', 'New accounts start as "pending" and must be approved by an admin before using the marketplace.')
on conflict (key) do nothing;

-- Admins are always treated as active (so turning approval on can't lock the admin out).
create or replace function public.is_active_user(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins where user_id = p_user)
      or coalesce((select status = 'active' from public.profiles where id = p_user), false)
$$;
revoke execute on function public.is_active_user from public, anon, authenticated;

-- Status is admin-controlled: users can't approve or un-suspend themselves.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role is not null and new.role is distinct from old.role and not public.is_admin() then
    raise exception 'role_locked: account type cannot be changed' using errcode = '42501';
  end if;
  if (new.status, new.status_reason, new.status_changed_at) is distinct from (old.status, old.status_reason, old.status_changed_at)
     and not public.is_admin() then
    raise exception 'status_locked: only an administrator can change account status' using errcode = '42501';
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;

-- New profiles start pending when approval is required.
create or replace function public.profiles_initial_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'require_account_approval'), false)
     and not exists (select 1 from public.app_admins where user_id = new.id) then
    new.status := 'pending';
  else
    new.status := 'active';
  end if;
  new.status_reason := null;
  new.status_changed_at := now();
  return new;
end $$;
drop trigger if exists profiles_initial_status on public.profiles;
create trigger profiles_initial_status before insert on public.profiles for each row execute function public.profiles_initial_status();

-- Blocks writes by accounts that aren't active. Runs first (trigger names sort before the existing ones).
-- TG_ARGV[0] = the column holding the acting user's id.
create or replace function public.require_active_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if not public.is_active_user(v_user) then
    raise exception 'account_not_active' using errcode = '42501',
      hint = coalesce((select status from public.profiles where id = v_user), 'missing');
  end if;
  return new;
end $$;
drop trigger if exists a_require_active on public.campaigns;
create trigger a_require_active before insert on public.campaigns for each row execute function public.require_active_account('owner_id');
drop trigger if exists a_require_active on public.applications;
create trigger a_require_active before insert on public.applications for each row execute function public.require_active_account('creator_id');
drop trigger if exists a_require_active on public.collab_requests;
create trigger a_require_active before insert on public.collab_requests for each row execute function public.require_active_account('brand_id');
drop trigger if exists a_require_active on public.saved_creators;
create trigger a_require_active before insert on public.saved_creators for each row execute function public.require_active_account('user_id');

-- Metered actions (profile views, searches, AI matches) also require an active account.
create or replace function public.consume_quota(p_feature text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not public.is_active_user(auth.uid()) then
    raise exception 'account_not_active' using errcode = '42501',
      hint = coalesce((select status from public.profiles where id = auth.uid()), 'missing');
  end if;
  if p_feature not in ('profile_view', 'search', 'ai_match') then
    raise exception 'feature % is enforced by the database, not consumable directly', p_feature;
  end if;
  return public._consume_quota(auth.uid(), p_feature, 1);
end $$;
revoke execute on function public.consume_quota from public, anon;
grant execute on function public.consume_quota to authenticated;

-- ---------------------------------------------------------------------
-- New registration notifications (fires when the email is verified, or at once for Google sign-ups)
-- ---------------------------------------------------------------------
create or replace function public.notify_new_registration(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.profiles;
  v_email text;
  v_admin uuid;
begin
  select * into v_p from public.profiles where id = p_user;
  select email into v_email from auth.users where id = p_user;
  if v_p.id is null then return; end if;
  for v_admin in select user_id from public.app_admins where user_id <> p_user loop
    perform public.enqueue_event(v_admin, 'admin_new_user',
      format('New registration: %s', coalesce(nullif(v_p.full_name, ''), v_email)),
      format('%s · %s · status: %s', v_email, coalesce(v_p.role, 'type not chosen'), v_p.status), '#/admin',
      'admin_new_registration', jsonb_build_object('name', v_p.full_name, 'email', v_email, 'role', v_p.role, 'status', v_p.status),
      'newuser:' || p_user || ':' || v_admin, 'activity');
  end loop;
  if v_p.status = 'pending' then
    perform public.enqueue_event(p_user, 'account_pending', 'Your account is awaiting approval',
      'An administrator will review your registration. We''ll email you when it''s approved.', '#/dashboard',
      'account_pending', '{}', 'pending:' || p_user, 'security');
  end if;
end $$;
revoke execute on function public.notify_new_registration from public, anon, authenticated;

create or replace function public.on_auth_user_registered() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null and (tg_op = 'INSERT' or old.email_confirmed_at is null) then
    perform public.notify_new_registration(new.id);
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_registered on auth.users;
create trigger on_auth_user_registered after insert or update of email_confirmed_at on auth.users
  for each row execute function public.on_auth_user_registered();

-- ---------------------------------------------------------------------
-- Admin-only API (each function verifies app_admins membership itself)
-- ---------------------------------------------------------------------
create or replace function public.admin_list_users(p_status text default null, p_search text default null, p_limit integer default 200)
returns table (id uuid, email text, full_name text, role text, status text, status_reason text,
               created_at timestamptz, email_confirmed_at timestamptz, last_sign_in_at timestamptz, is_admin boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.role, p.status, p.status_reason, p.created_at, u.email_confirmed_at, u.last_sign_in_at,
           exists (select 1 from public.app_admins a where a.user_id = p.id)
    from public.profiles p join auth.users u on u.id = p.id
    where (p_status is null or p.status = p_status)
      and (p_search is null or u.email ilike '%' || p_search || '%' or p.full_name ilike '%' || p_search || '%')
    order by (p.status = 'pending') desc, p.created_at desc
    limit greatest(1, least(p_limit, 500));
end $$;
revoke execute on function public.admin_list_users from public, anon;
grant execute on function public.admin_list_users to authenticated;

create or replace function public.admin_set_user_status(p_user uuid, p_status text, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'admins cannot change their own status'; end if;
  if p_status not in ('pending', 'active', 'rejected', 'suspended') then raise exception 'invalid status %', p_status; end if;
  select status into v_old from public.profiles where id = p_user;
  if v_old is null then raise exception 'user not found'; end if;
  if v_old = p_status then return; end if;
  update public.profiles set status = p_status, status_reason = nullif(left(coalesce(p_reason, ''), 500), ''), status_changed_at = now()
  where id = p_user;
  if p_status = 'active' then
    perform public.enqueue_event(p_user, 'account_approved',
      case when v_old = 'pending' then 'Your account has been approved' else 'Your account has been reactivated' end,
      'You now have full access to CreatorVerse AI.', '#/dashboard',
      'account_approved', jsonb_build_object('reactivated', v_old <> 'pending'),
      'status:' || p_user || ':active:' || extract(epoch from now())::bigint, 'security');
  elsif p_status in ('rejected', 'suspended') then
    perform public.enqueue_event(p_user, 'account_' || p_status,
      case p_status when 'rejected' then 'Your registration was not approved' else 'Your account has been suspended' end,
      coalesce(nullif(p_reason, ''), 'Contact support if you think this is a mistake.'), '#/dashboard',
      'account_' || p_status, jsonb_build_object('reason', left(coalesce(p_reason, ''), 500)),
      'status:' || p_user || ':' || p_status || ':' || extract(epoch from now())::bigint, 'security');
  end if;
end $$;
revoke execute on function public.admin_set_user_status from public, anon;
grant execute on function public.admin_set_user_status to authenticated;

create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'pending', (select count(*) from public.profiles where status = 'pending'),
    'active', (select count(*) from public.profiles where status = 'active'),
    'rejected', (select count(*) from public.profiles where status = 'rejected'),
    'suspended', (select count(*) from public.profiles where status = 'suspended'),
    'brands', (select count(*) from public.profiles where role = 'brand'),
    'creators', (select count(*) from public.profiles where role = 'creator'),
    'campaigns', (select count(*) from public.campaigns),
    'premium', (select count(distinct user_id) from public.subscriptions where status in ('active', 'pending')),
    'emails_failed', (select count(*) from public.email_outbox where status = 'failed'));
end $$;
revoke execute on function public.admin_stats from public, anon;
grant execute on function public.admin_stats to authenticated;
