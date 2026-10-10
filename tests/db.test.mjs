// Runs the real Supabase migration in PGlite (Postgres compiled to WASM) and tests
// Row Level Security, quotas, role guards and the notification/email outbox.
// Supabase's auth schema and API roles are stubbed minimally below.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const A = '00000000-0000-0000-0000-00000000000a'; // brand
const B = '00000000-0000-0000-0000-00000000000b'; // creator
const C = '00000000-0000-0000-0000-00000000000c'; // another brand
const ADMIN = '00000000-0000-0000-0000-0000000000ad';

const SUPABASE_STUBS = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key, email text, email_confirmed_at timestamptz, encrypted_password text,
    raw_user_meta_data jsonb default '{}', created_at timestamptz default now(), last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;
// Supabase grants these by default to the API roles
const SUPABASE_GRANTS = `
  grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant all on all sequences in schema public to anon, authenticated, service_role;
`;

// Run SQL as a signed-in user (RLS applies), as anon, or as the service role (bypasses RLS)
async function as(user, sql, params = []) {
  const role = user === 'anon' ? 'anon' : user === 'service' ? 'service_role' : 'authenticated';
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${user.length === 36 ? user : ''}', false);`);
  try { return await db.query(sql, params); }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const rows = async (...a) => (await as(...a)).rows;
const rejects = (p, re) => assert.rejects(p, re);

async function signup(id, email, name, confirmed = false) {
  await db.query(`insert into auth.users (id, email, encrypted_password, raw_user_meta_data, email_confirmed_at)
                  values ($1, $2, 'hash', jsonb_build_object('full_name', $3::text), $4)`, [id, email, name, confirmed ? new Date() : null]);
}

before(async () => {
  await db.exec(SUPABASE_STUBS);
  for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
  await db.exec(SUPABASE_GRANTS);
  await signup(A, 'brand@example.test', 'Nova Brands');
  await signup(B, 'creator@example.test', 'Kavya');
  await signup(C, 'other@example.test', 'Other Brand', true);
  await signup(ADMIN, 'admin@example.test', 'Admin', true);
});

test('signup creates profile + prefs; welcome only after verification, never duplicated', async () => {
  const p = await db.query(`select full_name, role from public.profiles where id = $1`, [A]);
  assert.equal(p.rows[0].full_name, 'Nova Brands');
  assert.equal((await db.query(`select count(*)::int n from public.notification_prefs where user_id = $1`, [A])).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int n from public.email_outbox where user_id = $1`, [A])).rows[0].n, 0);
  await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [A]);
  await db.query(`update auth.users set email_confirmed_at = null where id = $1`, [A]);
  await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [A]);  // re-verify: still one welcome
  const out = await db.query(`select template, to_email from public.email_outbox where user_id = $1`, [A]);
  assert.deepEqual(out.rows, [{ template: 'welcome', to_email: 'brand@example.test' }]);
  await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [B]);
});

test('password and email changes queue security emails', async () => {
  await db.query(`update auth.users set encrypted_password = 'new-hash' where id = $1`, [B]);
  const t = await db.query(`select template from public.email_outbox where user_id = $1 order by created_at`, [B]);
  assert.ok(t.rows.some(r => r.template === 'security_password_changed'));
});

test('account type from sign-up metadata; arbitrary roles ignored', async () => {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values
    ('00000000-0000-0000-0000-0000000000e1', 'e1@example.test', '{"full_name":"E1","account_type":"creator"}'),
    ('00000000-0000-0000-0000-0000000000e2', 'e2@example.test', '{"full_name":"E2","account_type":"admin"}')`);
  const r = await db.query(`select role from public.profiles where id in ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e2') order by id`);
  assert.deepEqual(r.rows.map(x => x.role), ['creator', null]);
  assert.equal((await db.query(`select count(*)::int n from public.app_admins`)).rows[0].n, 0);
});

test('users can read and edit only their own profile; role is set once', async () => {
  assert.equal((await rows(A, `select id from public.profiles`)).length, 1);
  assert.equal((await rows(A, `select id from public.profiles where id = $1`, [B])).length, 0);
  await as(A, `update public.profiles set role = 'brand' where id = $1`, [A]);
  await as(B, `update public.profiles set role = 'creator' where id = $1`, [B]);
  await as(C, `update public.profiles set role = 'brand' where id = $1`, [C]);
  await rejects(as(A, `update public.profiles set role = 'creator' where id = $1`, [A]), /role_locked/);
  const r = await as(A, `update public.profiles set full_name = 'Hacked' where id = $1`, [B]);
  assert.equal(r.affectedRows, 0);
  assert.equal((await db.query(`select full_name from public.profiles where id = $1`, [B])).rows[0].full_name, 'Kavya');
});

test('clients cannot grant themselves admin, premium, or call internal functions', async () => {
  await rejects(as(A, `insert into public.app_admins (user_id) values ($1)`, [A]), /row-level security/);
  await rejects(as(A, `insert into public.subscriptions (user_id, provider_subscription_id, plan_id, status) values ($1, 'sub_x', 'premium_monthly', 'active')`, [A]), /row-level security/);
  await rejects(as(A, `select public.enqueue_event($1, 'x', 'x', 'x', null, 'welcome', '{}', null, 'security')`, [A]), /permission denied/);
  await rejects(as(A, `select public._consume_quota($1, 'search', -100)`, [A]), /permission denied/);
  await rejects(as(A, `select public.consume_quota('campaign')`), /enforced by the database/);
  const upd = await as(A, `update public.plan_limits set limit_value = 9999 where tier = 'free'`);
  assert.equal(upd.affectedRows, 0);
  await rejects(as('anon', `select public.consume_quota('search')`), /permission denied/);
  assert.equal((await rows(A, `select * from public.email_outbox`)).length, 0);
  assert.equal((await rows(A, `select * from public.payment_events`)).length, 0);
});

test('search quota: 5 allowed, warning at 80%, limit email once, then denied', async () => {
  const res = [];
  for (let i = 0; i < 7; i++) res.push((await rows(A, `select public.consume_quota('search') q`))[0].q);
  assert.deepEqual(res.map(r => r.allowed), [true, true, true, true, true, false, false]);
  assert.equal(res[4].remaining, 0);
  assert.equal(res[5].used, 5);
  const t = (await db.query(`select template from public.email_outbox where user_id = $1 and template like 'usage%' order by created_at`, [A])).rows.map(r => r.template);
  assert.deepEqual(t, ['usage_warning', 'usage_limit_reached']);
  const n = await rows(A, `select kind from public.notifications where kind in ('usage_warning','limit_reached')`);
  assert.equal(n.length, 2);
});

test('usage email respects preferences, in-app notification is still recorded', async () => {
  await as(C, `update public.notification_prefs set email_usage = false where user_id = $1`, [C]);
  for (let i = 0; i < 3; i++) await as(C, `select public.consume_quota('ai_match')`);
  assert.equal((await db.query(`select count(*)::int n from public.email_outbox where user_id = $1 and template like 'usage%'`, [C])).rows[0].n, 0);
  assert.equal((await rows(C, `select kind from public.notifications where kind = 'limit_reached'`)).length, 1);
});

test('campaign limit is enforced by the database; creators cannot create campaigns', async () => {
  const ins = `insert into public.campaigns (owner_id, title, brief, category, budget_min, budget_max, platforms, deliverables, deadline)
               values ($1, 'Monsoon gel launch', 'Show your honest monsoon skincare routine with our gel.', 'beauty', 10000, 40000,
                       array['instagram'], array['1 Reel'], current_date + 20) returning id, brand_name`;
  const c1 = await rows(A, ins, [A]);
  assert.equal(c1[0].brand_name, 'Nova Brands');
  await rejects(as(A, ins, [A]), /quota_exceeded:campaign/);
  await rejects(as(B, ins, [B]), /only brand accounts/);
  await rejects(as(A, ins, [C]), /row-level security/);  // cannot create on behalf of someone else
  assert.ok((await db.query(`select 1 from public.email_outbox where template = 'campaign_created' and user_id = $1`, [A])).rows.length);
});

test('campaign visibility: open campaigns to members, drafts only to owner', async () => {
  await db.query(`insert into public.campaigns (owner_id, title, brief, category, budget_min, budget_max, platforms, deliverables, deadline, status)
                  values ($1, 'Secret draft plan', 'A private draft that nobody else should be able to read.', 'tech', 1000, 2000,
                          array['youtube'], array['1 video'], current_date + 5, 'draft')`, [C]);
  assert.equal((await rows(B, `select title from public.campaigns where status = 'draft'`)).length, 0);
  assert.equal((await rows(C, `select title from public.campaigns where status = 'draft'`)).length, 1);
  assert.equal((await rows(B, `select title from public.campaigns where status = 'open'`)).length, 1);
  const r = await as(B, `update public.campaigns set title = 'Defaced campaign' where owner_id = $1`, [A]);
  assert.equal(r.affectedRows, 0);
  const d = await as(B, `delete from public.campaigns where owner_id = $1`, [A]);
  assert.equal(d.affectedRows, 0);
});

test('applications: creator applies, owner reviews, strangers see nothing, roles cannot overreach', async () => {
  const camp = (await db.query(`select id from public.campaigns where owner_id = $1`, [A])).rows[0].id;
  const app = (await rows(B, `insert into public.applications (campaign_id, creator_id, rate, pitch)
    values ($1, $2, 15000, 'I would love to create an honest monsoon routine reel for you.') returning id, status, creator_name`, [camp, B]))[0];
  assert.equal(app.status, 'pending');
  assert.equal(app.creator_name, 'Kavya');
  await rejects(as(A, `insert into public.applications (campaign_id, creator_id, rate, pitch) values ($1, $2, 1000, 'Brands should not be able to apply at all here.')`, [camp, A]), /only creator accounts/);
  assert.equal((await rows(A, `select id from public.applications`)).length, 1);
  assert.equal((await rows(C, `select id from public.applications`)).length, 0);
  await rejects(as(B, `update public.applications set status = 'accepted' where id = $1`, [app.id]), /only withdraw/);
  await rejects(as(A, `update public.applications set pitch = 'changed by brand, which is not allowed at all' where id = $1`, [app.id]), /only change the status/);
  const s = await as(C, `update public.applications set status = 'declined' where id = $1`, [app.id]);
  assert.equal(s.affectedRows, 0);
  await as(A, `update public.applications set status = 'shortlisted' where id = $1`, [app.id]);
  const n = await rows(B, `select kind, title from public.notifications where kind = 'application_update'`);
  assert.equal(n.length, 1);
  assert.match(n[0].title, /shortlisted/);
  assert.ok((await db.query(`select 1 from public.email_outbox where template = 'application_received' and user_id = $1`, [A])).rows.length);
});

test('saved creators: free limit of 5 enforced by trigger, rows private', async () => {
  for (const id of ['aanya', 'rohan', 'sneha', 'priya', 'arjun']) await as(A, `insert into public.saved_creators (user_id, creator_ref) values ($1, $2)`, [A, id]);
  await rejects(as(A, `insert into public.saved_creators (user_id, creator_ref) values ($1, 'kavya')`, [A]), /quota_exceeded:saved_creator/);
  await rejects(as(C, `insert into public.saved_creators (user_id, creator_ref) values ($1, 'Bad Ref!')`, [C]), /check constraint/);
  assert.equal((await rows(B, `select * from public.saved_creators`)).length, 0);
  const plan = (await rows(A, `select public.my_plan() p`))[0].p;
  assert.equal(plan.tier, 'free');
  assert.equal(plan.usage.find(u => u.feature === 'saved_creator').used, 5);
  assert.equal(plan.usage.find(u => u.feature === 'search').used, 5);
});

test('notifications: users may mark read but not rewrite them', async () => {
  const n = (await rows(A, `select id from public.notifications limit 1`))[0];
  await as(A, `update public.notifications set read_at = now() where id = $1`, [n.id]);
  await rejects(as(A, `update public.notifications set title = 'fake' where id = $1`, [n.id]), /only read_at/);
  assert.equal((await rows(B, `select id from public.notifications where user_id = $1`, [A])).length, 0);
});

test('premium comes only from a server-written subscription; notifications fire once', async () => {
  // service role (Edge Function after verified payment) writes the subscription
  const ins = `insert into public.subscriptions (user_id, provider_subscription_id, plan_id, status, current_period_start, current_period_end)
               values ($1, 'sub_TEST1', 'premium_monthly', 'active', now(), now() + interval '30 days')`;
  await as('service', ins, [A]);
  await rejects(as('service', ins, [A]), /duplicate key/);  // idempotent on provider id
  assert.equal((await rows(A, `select public.my_plan() p`))[0].p.tier, 'premium');
  assert.equal((await rows(A, `select (public.consume_quota('search')) ->> 'allowed' a`))[0].a, 'true');  // higher limit now
  await as('service', `update public.subscriptions set status = 'active', updated_at = now() where provider_subscription_id = 'sub_TEST1'`);
  assert.equal((await db.query(`select count(*)::int n from public.email_outbox where template = 'subscription_activated'`)).rows[0].n, 1);
  await as('service', `update public.subscriptions set cancel_at_period_end = true where provider_subscription_id = 'sub_TEST1'`);
  await as('service', `update public.subscriptions set status = 'cancelled' where provider_subscription_id = 'sub_TEST1'`);
  assert.equal((await rows(A, `select public.my_plan() p`))[0].p.tier, 'free');
  const t = (await db.query(`select template from public.email_outbox where template like 'subscription%' order by created_at`)).rows.map(r => r.template);
  assert.deepEqual(t, ['subscription_activated', 'subscription_cancel_scheduled', 'subscription_ended']);
  assert.equal((await rows(B, `select * from public.subscriptions`)).length, 0);
});

test('email dispatcher claims each outbox row once; clients cannot claim', async () => {
  await rejects(as(A, `select * from public.claim_email_batch(5)`), /permission denied/);
  const pending = (await db.query(`select count(*)::int n from public.email_outbox where status = 'pending'`)).rows[0].n;
  const first = await rows('service', `select id, status, attempts from public.claim_email_batch(100)`);
  assert.equal(first.length, pending);
  assert.ok(first.every(r => r.status === 'sending' && r.attempts === 1));
  assert.equal((await rows('service', `select id from public.claim_email_batch(100)`)).length, 0);  // nothing double-sent
  await as('service', `update public.email_outbox set status = 'failed' where id = $1`, [first[0].id]);
  assert.equal((await rows('service', `select id from public.claim_email_batch(100)`)).length, 1);  // failed rows retry
});

test('payment failure notice is recorded once per payment', async () => {
  await rejects(as(A, `select public.notify_payment_failed('sub_TEST1', 'pay_1', 'x')`), /permission denied/);
  await as('service', `select public.notify_payment_failed('sub_TEST1', 'pay_1', 'Card declined')`);
  await as('service', `select public.notify_payment_failed('sub_TEST1', 'pay_1', 'Card declined')`);
  assert.equal((await db.query(`select count(*)::int n from public.email_outbox where template = 'payment_failed'`)).rows[0].n, 1);
  assert.equal((await rows(A, `select id from public.notifications where kind = 'payment_failed'`)).length, 1);
});

test('admins (and only admins) can change limits and plan prices', async () => {
  await db.query(`insert into public.app_admins (user_id) values ($1)`, [ADMIN]);
  const u = await as(ADMIN, `update public.plan_limits set limit_value = 7 where tier = 'free' and feature = 'search'`);
  assert.equal(u.affectedRows, 1);
  const p = await as(ADMIN, `update public.plans set price_inr = 1299 where id = 'premium_monthly'`);
  assert.equal(p.affectedRows, 1);
  assert.equal((await rows(ADMIN, `select public.my_plan() p`))[0].p.is_admin, true);
  assert.equal((await rows(A, `select public.my_plan() p`))[0].p.is_admin, false);
  assert.equal((await rows('anon', `select price_inr from public.plans where id = 'premium_monthly'`))[0].price_inr, 1299);
});

// ---------------- account approval (20261010000200) ----------------
const P = '00000000-0000-0000-0000-0000000000f1';  // signs up while approval is required
const Q = '00000000-0000-0000-0000-0000000000f2';

test('existing users stay active after the approval migration', async () => {
  const r = await db.query(`select status from public.profiles where id in ($1, $2)`, [A, B]);
  assert.ok(r.rows.every(x => x.status === 'active'));
});

test('with approval required, new sign-ups are pending and admins are notified on verification', async () => {
  await db.query(`update public.app_settings set value = 'true' where key = 'require_account_approval'`);
  await signup(P, 'pending@example.test', 'Pending Person');
  await signup(Q, 'second@example.test', 'Second Person');
  assert.equal((await db.query(`select status from public.profiles where id = $1`, [P])).rows[0].status, 'pending');
  assert.equal((await db.query(`select count(*)::int n from public.email_outbox where template = 'admin_new_registration'`)).rows[0].n, 0); // not verified yet
  await db.query(`update auth.users set email_confirmed_at = now() where id in ($1, $2)`, [P, Q]);
  const adminMail = await db.query(`select to_email, data from public.email_outbox where template = 'admin_new_registration' and data->>'email' = 'pending@example.test'`);
  assert.equal(adminMail.rows.length, 1);
  assert.equal(adminMail.rows[0].to_email, 'admin@example.test');
  assert.ok((await db.query(`select 1 from public.email_outbox where template = 'account_pending' and user_id = $1`, [P])).rows.length);
  assert.equal((await rows(ADMIN, `select kind from public.notifications where kind = 'admin_new_user'`)).length, 2);
});

test('pending accounts cannot use metered tools or write data', async () => {
  await as(P, `update public.profiles set role = 'brand' where id = $1`, [P]);
  await rejects(as(P, `select public.consume_quota('search')`), /account_not_active/);
  await rejects(as(P, `insert into public.saved_creators (user_id, creator_ref) values ($1, 'aanya')`, [P]), /account_not_active/);
  await rejects(as(P, `insert into public.campaigns (owner_id, title, brief, category, budget_min, budget_max, platforms, deliverables, deadline)
    values ($1, 'Pending launch', 'This should be refused because the account is not approved.', 'tech', 1000, 2000, array['youtube'], array['1 video'], current_date + 5)`, [P]), /account_not_active/);
  assert.equal((await db.query(`select count(*)::int n from public.usage_counters where user_id = $1`, [P])).rows[0].n, 0);
});

test('users cannot approve themselves; non-admins cannot use admin functions', async () => {
  await rejects(as(P, `update public.profiles set status = 'active' where id = $1`, [P]), /status_locked/);
  await rejects(as(A, `select * from public.admin_list_users()`), /admin_only/);
  await rejects(as(A, `select public.admin_set_user_status($1, 'active')`, [P]), /admin_only/);
  await rejects(as(A, `select public.admin_stats()`), /admin_only/);
  await rejects(as('anon', `select * from public.admin_list_users()`), /permission denied/);
  assert.equal((await db.query(`select status from public.profiles where id = $1`, [P])).rows[0].status, 'pending');
});

test('admin dashboard: list, approve (email sent), reject with reason, cannot change own status', async () => {
  const pending = await rows(ADMIN, `select email, status from public.admin_list_users('pending')`);
  assert.deepEqual(pending.map(r => r.email).sort(), ['pending@example.test', 'second@example.test']);
  const stats = (await rows(ADMIN, `select public.admin_stats() s`))[0].s;
  assert.equal(stats.pending, 2);
  await as(ADMIN, `select public.admin_set_user_status($1, 'active')`, [P]);
  assert.equal((await db.query(`select status from public.profiles where id = $1`, [P])).rows[0].status, 'active');
  assert.ok((await db.query(`select 1 from public.email_outbox where template = 'account_approved' and user_id = $1`, [P])).rows.length);
  assert.equal((await rows(P, `select (public.consume_quota('search')) ->> 'allowed' a`))[0].a, 'true');  // now allowed
  await as(ADMIN, `select public.admin_set_user_status($1, 'rejected', 'Incomplete business details')`, [Q]);
  const rej = await db.query(`select data->>'reason' reason from public.email_outbox where template = 'account_rejected' and user_id = $1`, [Q]);
  assert.equal(rej.rows[0].reason, 'Incomplete business details');
  await rejects(as(ADMIN, `select public.admin_set_user_status($1, 'suspended')`, [ADMIN]), /own status/);
  await db.query(`update public.app_settings set value = 'false' where key = 'require_account_approval'`);
});
