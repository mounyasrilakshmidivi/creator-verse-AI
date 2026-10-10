// Tests for 20261010000400_emails_campaigns_reports.sql (all migrations applied in order):
// welcome/login/message emails, preferences & consent, campaigns, delivery tracking, and the login report.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const CR = '20000000-0000-0000-0000-00000000000c';  // creator, opted in to marketing
const BR = '20000000-0000-0000-0000-00000000000b';  // brand, not opted in
const UV = '20000000-0000-0000-0000-0000000000a1';  // never verified
const ADM = '20000000-0000-0000-0000-0000000000ad';

before(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, encrypted_password text,
      raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', created_at timestamptz default now(), last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`);
  for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to anon, authenticated, service_role;
    grant all on all sequences in schema public to anon, authenticated, service_role;`);
  const add = (id, email, name, type, optIn) => db.query(`insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data)
    values ($1, $2, 'hash', jsonb_build_object('full_name', $3::text, 'account_type', $4::text, 'marketing_opt_in', $5::boolean), '{"provider":"email"}')`, [id, email, name, type, optIn]);
  await add(CR, 'kavya@example.test', 'Kavya Reddy', 'creator', true);
  await add(BR, 'nova@example.test', 'Nova Brands', 'brand', false);
  await add(UV, 'unverified@example.test', 'Never Verified', 'creator', true);
  await add(ADM, 'admin@example.test', 'Admin', 'brand', false);
  await db.query(`insert into public.app_admins (user_id) values ($1)`, [ADM]);
});

async function as(user, sql, params = []) {
  const role = user === 'anon' ? 'anon' : user === 'service' ? 'service_role' : 'authenticated';
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${user.length === 36 ? user : ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const rows = async (...a) => (await as(...a)).rows;
const one = async (...a) => (await rows(...a))[0];
const rejects = (p, re) => assert.rejects(p, re);
const outbox = async (where, params = []) => (await db.query(`select * from public.email_outbox where ${where} order by created_at`, params)).rows;

test('welcome email after verification includes display name and account type; unverified users get nothing', async () => {
  await db.query(`update auth.users set email_confirmed_at = now() - interval '1 day' where id in ($1, $2, $3)`, [CR, BR, ADM]);
  const w = await outbox(`template = 'welcome' and user_id = $1`, [CR]);
  assert.equal(w.length, 1);
  assert.equal(w[0].data.name, 'Kavya Reddy');
  assert.equal(w[0].data.role, 'creator');
  assert.equal(w[0].to_email, 'kavya@example.test');
  assert.equal((await outbox(`user_id = $1`, [UV])).length, 0);
});

test('marketing consent comes only from the user (sign-up opt-in or own setting); token cannot be replaced; one-click unsubscribe', async () => {
  const prefs = (await db.query(`select user_id, email_marketing, marketing_consent_at, unsubscribe_token from public.notification_prefs order by user_id`)).rows;
  const cr = prefs.find(p => p.user_id === CR), br = prefs.find(p => p.user_id === BR);
  assert.equal(cr.email_marketing, true); assert.ok(cr.marketing_consent_at);
  assert.equal(br.email_marketing, false); assert.equal(br.marketing_consent_at, null);
  await as(BR, `update public.notification_prefs set unsubscribe_token = gen_random_uuid() where user_id = $1`, [BR]);
  assert.equal((await db.query(`select unsubscribe_token from public.notification_prefs where user_id = $1`, [BR])).rows[0].unsubscribe_token, br.unsubscribe_token);
  assert.equal((await rows(BR, `select * from public.notification_prefs`)).length, 1);  // only own row
  assert.equal((await one('anon', `select public.unsubscribe_marketing(gen_random_uuid()) ok`)).ok, false);
  // opting in later from Account settings is timestamped; switching off again is respected
  await as(BR, `update public.notification_prefs set email_marketing = true where user_id = $1`, [BR]);
  assert.ok((await db.query(`select marketing_consent_at from public.notification_prefs where user_id = $1`, [BR])).rows[0].marketing_consent_at);
  await as(BR, `update public.notification_prefs set email_marketing = false where user_id = $1`, [BR]);
  // another user's row can't be changed
  await as(BR, `update public.notification_prefs set email_marketing = true where user_id = $1`, [CR]);
  await as(CR, `update public.notification_prefs set email_marketing = false where user_id = $1`, [CR]);
  await as(BR, `update public.notification_prefs set email_marketing = true where user_id = $1`, [CR]);
  assert.equal((await db.query(`select email_marketing from public.notification_prefs where user_id = $1`, [CR])).rows[0].email_marketing, false);
  await as(CR, `update public.notification_prefs set email_marketing = true where user_id = $1`, [CR]);
});

test('login alert on later sign-ins, respecting the preference; never on the verification sign-in', async () => {
  await db.query(`update auth.users set last_sign_in_at = now() - interval '1 day' + interval '30 seconds' where id = $1`, [CR]);  // verification sign-in
  assert.equal((await outbox(`template = 'login_alert'`)).length, 0);
  await db.query(`update auth.users set last_sign_in_at = now() where id = $1`, [CR]);
  const a = await outbox(`template = 'login_alert' and user_id = $1`, [CR]);
  assert.equal(a.length, 1);
  assert.ok(a[0].data.at);
  assert.ok(!JSON.stringify(a[0].data).match(/pass|token|secret/i));
  await as(BR, `update public.notification_prefs set email_login = false where user_id = $1`, [BR]);
  await db.query(`update auth.users set last_sign_in_at = now() where id = $1`, [BR]);
  assert.equal((await outbox(`template = 'login_alert' and user_id = $1`, [BR])).length, 0);
  assert.equal((await db.query(`select count(*)::int n from public.login_events where user_id = $1 and status = 'success'`, [BR])).rows[0].n, 1);  // still recorded
});

test('new message email: no message text, throttled per conversation, preference respected', async () => {
  await as(CR, `insert into public.creator_profiles (user_id, display_name, bio, published) values ($1, 'Kavya Reddy', 'Gaming streams in Telugu and English.', true)`, [CR]);
  const conv = (await one(BR, `select public.start_conversation($1) c`, [CR])).c;
  await as(BR, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'Private budget is 50000 rupees')`, [conv, BR]);
  await as(BR, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'Second message')`, [conv, BR]);
  const m = await outbox(`template = 'new_message' and user_id = $1`, [CR]);
  assert.equal(m.length, 1);  // throttled
  assert.equal(m[0].data.name, 'Nova Brands');
  assert.ok(!JSON.stringify(m[0].data).includes('50000'));  // private text not in the email
  await as(BR, `update public.notification_prefs set email_messages = false where user_id = $1`, [BR]);
  await as(CR, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'Reply')`, [conv, CR]);
  assert.equal((await outbox(`template = 'new_message' and user_id = $1`, [BR])).length, 0);
  assert.equal((await rows(BR, `select id from public.notifications where kind = 'new_message'`)).length, 1);  // in-app still shown
});

test('campaigns: admin only, opted-in verified audience, test email, confirmed launch, no duplicates', async () => {
  await rejects(as(CR, `select public.admin_campaign_audience('all')`), /admin_only/);
  await rejects(as(CR, `select public.admin_save_campaign(null, 'all', 'Hello there', 'Some announcement body text')`), /admin_only/);
  assert.equal((await rows(CR, `select * from public.email_campaigns`)).length, 0);
  const aud = (await one(ADM, `select public.admin_campaign_audience('all') a`)).a;
  assert.equal(aud.eligible, 1);  // only Kavya: opted in AND verified (UV opted in but unverified)
  assert.equal((await one(ADM, `select public.admin_campaign_audience('brand') a`)).a.eligible, 0);
  const id = (await one(ADM, `select public.admin_save_campaign(null, 'all', 'October update', 'New: AI Matching improvements and a creator directory.') id`)).id;
  await as(ADM, `select public.admin_send_campaign_test($1)`, [id]);
  const test = await outbox(`template = 'campaign' and user_id = $1`, [ADM]);
  assert.equal(test.length, 1); assert.match(test[0].data.subject, /^\[TEST\]/); assert.equal(test[0].campaign_id, null);
  await rejects(as(ADM, `select public.admin_launch_campaign($1, 'yes')`, [id]), /Type SEND/);
  assert.equal((await one(ADM, `select public.admin_launch_campaign($1, 'SEND') n`, [id])).n, 1);
  await rejects(as(ADM, `select public.admin_launch_campaign($1, 'SEND')`, [id]), /already launched/);
  const sent = await outbox(`campaign_id = $1`, [id]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to_email, 'kavya@example.test');
  assert.ok(sent[0].data.unsubscribe_token);
  await rejects(as(ADM, `select public.admin_save_campaign($1, 'all', 'Changed', 'Changed body text here')`, [id]), /Only draft/);
  const list = await rows(ADM, `select subject, status, recipient_count, queued from public.admin_list_campaigns()`);
  assert.equal(list[0].status, 'queued'); assert.equal(Number(list[0].queued), 1);
  // unsubscribing cancels anything still queued for that user
  const token = (await db.query(`select unsubscribe_token from public.notification_prefs where user_id = $1`, [CR])).rows[0].unsubscribe_token;
  assert.equal((await one('anon', `select public.unsubscribe_marketing($1) ok`, [token])).ok, true);
  assert.equal((await outbox(`campaign_id = $1`, [id]))[0].status, 'skipped');
  assert.equal((await one(ADM, `select public.admin_campaign_audience('all') a`)).a.eligible, 0);
});

test('delivery tracking from the provider webhook (service role only); bounces stop campaigns', async () => {
  const row = (await outbox(`template = 'welcome' and user_id = $1`, [BR]))[0];
  await db.query(`update public.email_outbox set status = 'sent', provider_message_id = 're_123' where id = $1`, [row.id]);
  await rejects(as(BR, `select public.record_email_event('re_123', 'email.delivered')`), /permission denied/);
  await as('service', `select public.record_email_event('re_123', 'email.delivered')`);
  assert.equal((await outbox(`id = $1`, [row.id]))[0].status, 'delivered');
  await db.query(`update public.notification_prefs set email_marketing = true where user_id = $1`, [BR]);
  await as('service', `select public.record_email_event('re_123', 'email.bounced')`);
  assert.equal((await outbox(`id = $1`, [row.id]))[0].status, 'bounced');
  assert.equal((await db.query(`select email_marketing from public.notification_prefs where user_id = $1`, [BR])).rows[0].email_marketing, false);
  assert.equal((await one('service', `select public.record_email_event('unknown', 'email.delivered') ok`)).ok, false);
});

test('login report: admin only; numbers match the raw records; daily rows zero-filled; role filter', async () => {
  await rejects(as(CR, `select public.admin_login_report(now() - interval '7 days', now())`), /admin_only/);
  await as('anon', `select public.record_login_failure('kavya@example.test', 'invalid_credentials')`);
  await as('anon', `select public.record_login_failure('nova@example.test', 'invalid_credentials')`);
  await as('anon', `select public.record_login_failure('ghost@example.test', 'invalid_credentials')`);
  await db.query(`insert into public.login_events (user_id, email, role, status, method, source, occurred_at)
    values ($1, 'kavya@example.test', 'creator', 'success', 'password', 'auth', now() - interval '20 days')`, [CR]);  // previous period
  const r = (await one(ADM, `select public.admin_login_report(now() - interval '7 days', now() + interval '1 minute') r`)).r;
  const raw = (await db.query(`select status, count(*)::int n, count(distinct user_id)::int u from public.login_events
                                where occurred_at >= now() - interval '7 days' group by status`)).rows;
  assert.equal(r.summary.successful_logins, raw.find(x => x.status === 'success').n);
  assert.equal(r.summary.failed_logins, raw.find(x => x.status === 'failure').n);
  assert.equal(r.summary.unique_users, raw.find(x => x.status === 'success').u);
  assert.equal(r.summary.users_total, 4); assert.equal(r.summary.creators, 2); assert.equal(r.summary.brands, 2);
  assert.equal(r.summary.never_logged_in, 2);  // unverified user + admin
  assert.equal(r.daily.length, 8);              // 7 days + today, zero-filled
  assert.equal(r.daily.reduce((s, d) => s + d.success, 0), r.summary.successful_logins);
  assert.equal(r.daily.reduce((s, d) => s + d.registrations, 0), 4);
  const creators = r.roles.find(x => x.role === 'creator');
  assert.equal(creators.failure, 1);  // ghost@ has no account, so no role
  assert.equal(r.previous.successful_logins, 0);  // -20 days is outside the previous 7-day window
  const crRaw = (await db.query(`select count(*)::int n from public.login_events where user_id = $1 and status = 'success'
                                  and occurred_at >= now() - interval '7 days'`, [CR])).rows[0].n;
  assert.equal(r.users.find(u => u.user_id === CR).logins_in_period, crRaw);
  const onlyBrands = (await one(ADM, `select public.admin_login_report(now() - interval '30 days', now() + interval '1 minute', 'brand') r`)).r;
  assert.equal(onlyBrands.summary.users_total, 2);
  assert.ok(onlyBrands.users.every(u => u.role === 'brand'));
  assert.equal(onlyBrands.roles.length, 1);
  await rejects(as(ADM, `select public.admin_login_report(now(), now() - interval '1 day')`), /end date/);
});

test('backfill creates profiles for accounts that existed before the tables, without touching existing rows', async () => {
  const OLD = '20000000-0000-0000-0000-0000000000e1';
  await db.exec(`alter table auth.users disable trigger user`);  // simulate a sign-up from before the migrations
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, 'early@example.test', now(),
    '{"full_name":"Early Bird","account_type":"brand"}')`, [OLD]);
  await db.exec(`alter table auth.users enable trigger user`);
  assert.equal((await db.query(`select 1 from public.profiles where id = $1`, [OLD])).rows.length, 0);
  const before = (await db.query(`select full_name, role, status from public.profiles where id = $1`, [CR])).rows[0];
  const sql = readFileSync('supabase/migrations/20261010000500_backfill_existing_users.sql', 'utf8');
  await db.exec(sql); await db.exec(sql);  // re-runnable
  const p = (await db.query(`select full_name, role, status from public.profiles where id = $1`, [OLD])).rows[0];
  assert.deepEqual(p, { full_name: 'Early Bird', role: 'brand', status: 'active' });
  assert.equal((await db.query(`select count(*)::int n from public.notification_prefs where user_id = $1`, [OLD])).rows[0].n, 1);
  assert.deepEqual((await db.query(`select full_name, role, status from public.profiles where id = $1`, [CR])).rows[0], before);
});

test('the five added niches are accepted for creator profiles; the original ten still are; unknown niches are rejected', async () => {
  const niches = (await db.query(`select public.valid_niches() n`)).rows[0].n;
  assert.equal(niches.length, 15);
  for (const n of ['fashion', 'tech', 'food', 'fitness', 'travel', 'beauty', 'gaming', 'education', 'music', 'photography',
                   'comedy', 'art', 'finance', 'home', 'parenting']) assert.ok(niches.includes(n), n);
  await as(CR, `insert into public.creator_profiles (user_id, display_name, niches) values ($1, 'Kavya Reddy', '{comedy,parenting,fashion}')
                on conflict (user_id) do update set niches = excluded.niches`, [CR]);
  assert.deepEqual((await db.query(`select niches from public.creator_profiles where user_id = $1`, [CR])).rows[0].niches, ['comedy', 'parenting', 'fashion']);
  await rejects(as(CR, `update public.creator_profiles set niches = '{astrology}' where user_id = $1`, [CR]), /check constraint/);
});
