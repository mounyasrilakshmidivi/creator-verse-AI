-- CreatorVerse AI: accounts that signed up BEFORE these tables existed have no profile row.
-- Create the missing rows from the sign-up details Supabase Auth already stored, so those users can
-- sign in and use the app immediately. Safe to run more than once; never changes existing rows.

insert into public.profiles (id, full_name, role)
select u.id,
       left(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', ''), 120),
       case when u.raw_user_meta_data ->> 'account_type' in ('brand', 'creator') then u.raw_user_meta_data ->> 'account_type' end
from auth.users u
on conflict (id) do nothing;

insert into public.notification_prefs (user_id)
select u.id from auth.users u
on conflict do nothing;
