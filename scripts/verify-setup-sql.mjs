// Checks that supabase/SETUP_ALL_IN_ONE.sql applies cleanly to an empty database (with existing users to backfill).
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, encrypted_password text,
    raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', created_at timestamptz default now(), last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
    values ('30000000-0000-0000-0000-000000000001', 'existing@example.test', now(), '{"full_name":"Existing User","account_type":"creator"}');`);
await db.exec(readFileSync('supabase/SETUP_ALL_IN_ONE.sql', 'utf8'));
const tables = (await db.query(`select count(*)::int n from information_schema.tables where table_schema = 'public'`)).rows[0].n;
const prof = (await db.query(`select full_name, role, status from public.profiles`)).rows;
console.log(JSON.stringify({ tables, existingUserProfile: prof }));
// all-or-nothing: a second run must fail and leave the database unchanged
try { await db.exec(readFileSync('supabase/SETUP_ALL_IN_ONE.sql', 'utf8')); console.log('second run unexpectedly succeeded'); }
catch (e) { await db.exec('rollback').catch(() => {}); console.log('second run rejected as expected:', e.message.slice(0, 60)); }
