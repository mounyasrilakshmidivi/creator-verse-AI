// Tests for 20261010000300_network_and_analytics.sql (with all earlier migrations applied):
// login analytics, member profiles, collaboration requests, messaging and connections, and their security rules.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const CR = '10000000-0000-0000-0000-00000000000c'; // creator (Kavya)
const BR = '10000000-0000-0000-0000-00000000000b'; // brand (Nova)
const X = '10000000-0000-0000-0000-0000000000ee';  // unrelated third user
const ADM = '10000000-0000-0000-0000-0000000000ad'; // admin

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
  const users = [[CR, 'kavya@example.test', 'Kavya Reddy', 'creator'], [BR, 'nova@example.test', 'Nova Brands', 'brand'],
    [X, 'x@example.test', 'Stranger', 'brand'], [ADM, 'admin@example.test', 'Admin', 'brand']];
  for (const [id, email, name, type] of users) {
    await db.query(`insert into auth.users (id, email, encrypted_password, raw_user_meta_data, email_confirmed_at, raw_app_meta_data)
      values ($1, $2, 'hash', jsonb_build_object('full_name', $3::text, 'account_type', $4::text), now(), '{"provider":"email"}')`, [id, email, name, type]);
  }
  await db.query(`insert into public.app_admins (user_id) values ($1)`, [ADM]);
});

async function as(user, sql, params = []) {
  const role = user === 'anon' ? 'anon' : 'authenticated';
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${user === 'anon' ? '' : user}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const rows = async (...a) => (await as(...a)).rows;
const one = async (...a) => (await rows(...a))[0];
const rejects = (p, re) => assert.rejects(p, re);
const notifs = async (user, kind) => (await db.query(`select title from public.notifications where user_id = $1 and kind = $2`, [user, kind])).rows;

test('profiles: owners publish with chosen visibility; others see only published, permitted fields', async () => {
  await as(CR, `insert into public.creator_profiles (user_id, display_name, bio, niches, languages, city, published, portfolio_links, skills, availability, show_social_links)
    values ($1, 'Kavya Reddy', 'Gaming streams and esports commentary in Telugu.', array['gaming'], array['Telugu','English'], 'Hyderabad', true,
            array['https://youtube.com/@kavya'], array['Streaming','Editing'], 'open', false)`, [CR]);
  await as(CR, `insert into public.creator_social_links (user_id, platform, url) values ($1, 'youtube', 'https://youtube.com/@kavya')`, [CR]);
  await as(CR, `insert into public.creator_stats (user_id, followers, engagement_rate, visible) values ($1, 120000, 6.4, false)`, [CR]);
  const viewed = (await one(BR, `select public.get_member_profile($1) p`, [CR])).p;
  assert.equal(viewed.name, 'Kavya Reddy');
  assert.equal(viewed.creator.availability, 'open');
  assert.deepEqual(viewed.creator.skills, ['Streaming', 'Editing']);
  assert.equal(viewed.creator.social_links, null);  // owner hid social links
  assert.equal(viewed.creator.stats, null);         // owner hid stats
  assert.equal((await rows(BR, `select * from public.creator_social_links`)).length, 0);  // direct table read also hidden
  assert.equal((await rows(BR, `select * from public.creator_stats`)).length, 0);
  const self = (await one(CR, `select public.get_member_profile($1) p`, [CR])).p;
  assert.equal(self.creator.stats.followers, 120000);  // owner always sees own data
  // brand profile hidden until published
  await as(BR, `insert into public.brand_profiles (user_id, business_name, industry, description, website, campaign_requirements, collaboration_opportunities)
    values ($1, 'Nova Brands', 'Consumer tech', 'Wireless audio for gamers.', 'https://nova.example', 'Telugu gaming creators', 'Launch streams')`, [BR]);
  assert.equal((await one(CR, `select public.get_member_profile($1) p`, [BR])).p.available, false);
  await as(BR, `update public.brand_profiles set published = true where user_id = $1`, [BR]);
  const brand = (await one(CR, `select public.get_member_profile($1) p`, [BR])).p;
  assert.equal(brand.brand.website, 'https://nova.example');
  await rejects(as('anon', `select public.get_member_profile($1)`, [CR]), /permission denied/);
  // directory
  const list = await rows(BR, `select id, role, name from public.list_members()`);
  assert.deepEqual(list.map(r => r.name), ['Kavya Reddy']);  // excludes self, unpublished X
  assert.equal((await rows(CR, `select name from public.list_members('brand')`))[0].name, 'Nova Brands');
});

test('login analytics: successful sign-ins recorded by the database, failures via rate-limited report', async () => {
  await db.query(`update auth.users set last_sign_in_at = now() where id in ($1, $2)`, [CR, BR]);
  await db.query(`update auth.users set last_sign_in_at = now() + interval '1 second' where id = $1`, [CR]);
  await db.query(`update auth.users set email = email where id = $1`, [CR]);  // unrelated update: no event
  const ok = (await db.query(`select user_id, role, status, source, email from public.login_events where status = 'success' order by id`)).rows;
  assert.equal(ok.length, 3);
  assert.equal(ok[0].role, 'creator');
  assert.ok(ok.every(e => e.source === 'auth'));
  await as('anon', `select public.record_login_failure('Kavya@Example.test', 'invalid_credentials')`);
  await as('anon', `select public.record_login_failure('nobody@example.test', 'invalid_credentials')`);
  await as('anon', `select public.record_login_failure('not-an-email', 'invalid_credentials')`);  // ignored
  for (let i = 0; i < 15; i++) await as('anon', `select public.record_login_failure('spam@example.test', 'invalid_credentials')`);
  const fails = (await db.query(`select email, user_id, source from public.login_events where status = 'failure'`)).rows;
  assert.equal(fails.filter(f => f.email === 'kavya@example.test')[0].user_id, CR);
  assert.equal(fails.filter(f => f.email === 'nobody@example.test')[0].user_id, null);
  assert.equal(fails.filter(f => f.email === 'spam@example.test').length, 10);  // rate limit
  assert.ok(fails.every(f => f.source === 'client_report'));
  // no secrets stored: the table has no password/token columns
  const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'login_events'`)).rows.map(r => r.column_name);
  assert.ok(!cols.some(c => /pass|token|secret|ip/.test(c)));
});

test('login analytics are admin-only (table, report and overview)', async () => {
  assert.equal((await rows(CR, `select * from public.login_events`)).length, 0);
  assert.equal((await rows('anon', `select * from public.login_events`)).length, 0);
  await rejects(as(CR, `select * from public.admin_login_events()`), /admin_only/);
  await rejects(as(CR, `select public.admin_analytics()`), /admin_only/);
  await rejects(as(CR, `insert into public.login_events (status, source) values ('success', 'auth')`), /row-level security/);
  const all = await rows(ADM, `select * from public.admin_login_events(null, null, null, null, null, 100, 0)`);
  assert.equal(Number(all[0].total_count), 15);
  const creatorsOk = await rows(ADM, `select user_name, email, user_role, status, account_created_at from public.admin_login_events(null, null, 'creator', 'success', null, 100, 0)`);
  assert.equal(creatorsOk.length, 2);
  assert.equal(creatorsOk[0].user_name, 'Kavya Reddy');
  assert.ok(creatorsOk[0].account_created_at);
  const page2 = await rows(ADM, `select event_id from public.admin_login_events(null, null, null, null, null, 5, 10)`);
  assert.equal(page2.length, 5);
  const search = await rows(ADM, `select email from public.admin_login_events(null, null, null, 'failure', 'kavya', 100, 0)`);
  assert.deepEqual(search.map(r => r.email), ['kavya@example.test']);
  const a = (await one(ADM, `select public.admin_analytics() a`)).a;
  assert.equal(a.logins_success, 3); assert.equal(a.logins_failure, 12); assert.equal(a.creators_total, 1); assert.equal(a.brands_total, 3);
});

test('collaboration requests: send, no duplicates or self-requests, notify, accept opens a conversation', async () => {
  const ins = `insert into public.collaboration_requests (sender_id, recipient_id, subject, purpose, campaign_details, budget, message)
               values ($1, $2, 'Diwali headset launch', 'Sponsored stream', 'Two live streams in November', 50000, 'We would love you to stream with our new headset.') returning id, status`;
  const r = await one(BR, ins, [BR, CR]);
  assert.equal(r.status, 'pending');
  await rejects(as(BR, ins, [BR, CR]), /already have a pending|duplicate key/);
  await rejects(as(CR, ins, [CR, CR]), /violates check constraint|not accepting/);
  await rejects(as(X, ins, [BR, CR]), /own account/);               // cannot send as someone else (no info leaked)
  await rejects(as(CR, ins, [CR, X]), /not accepting/);              // X is not a published member
  assert.equal((await notifs(CR, 'member_collab_request')).length, 1);
  assert.ok((await db.query(`select 1 from public.email_outbox where template = 'member_collab_request' and user_id = $1`, [CR])).rows.length);
  assert.equal((await rows(X, `select * from public.collaboration_requests`)).length, 0);  // strangers see nothing
  await rejects(as(BR, `select public.respond_collaboration($1, 'accept')`, [r.id]), /not allowed/);  // sender can't accept
  await rejects(as(X, `select public.respond_collaboration($1, 'decline')`, [r.id]), /not found/);
  const upd = await as(CR, `update public.collaboration_requests set status = 'accepted' where id = $1`, [r.id]);
  assert.equal(upd.affectedRows, 0);  // no direct status edits
  const res = (await one(CR, `select public.respond_collaboration($1, 'accept', 'Happy to!') r`, [r.id])).r;
  assert.equal(res.status, 'accepted');
  assert.ok(res.conversation_id);
  assert.equal((await notifs(BR, 'member_collab_update')).length, 1);
  const sys = await rows(BR, `select kind, body from public.messages where conversation_id = $1`, [res.conversation_id]);
  assert.equal(sys[0].kind, 'system');
  assert.equal((await one(BR, `select public.respond_collaboration($1, 'complete') r`, [r.id])).r.status, 'completed');
  // a new request is allowed once the previous one is no longer pending; cancel works for the sender
  const r2 = await one(BR, ins, [BR, CR]);
  assert.equal((await one(BR, `select public.respond_collaboration($1, 'cancel') r`, [r2.id])).r.status, 'cancelled');
});

test('messaging: participants only, validation, unread counts, notifications', async () => {
  const conv = (await one(CR, `select public.start_conversation($1) c`, [BR])).c;
  assert.equal((await one(BR, `select public.start_conversation($1) c`, [CR])).c, conv);  // same conversation both ways
  await rejects(as(CR, `select public.start_conversation($1)`, [CR]), /yourself/);
  await as(BR, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, '  Hi Kavya! Can we plan the first stream?  ')`, [conv, BR]);
  await rejects(as(BR, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, '   ')`, [conv, BR]), /check constraint/);
  await rejects(as(BR, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'spoof')`, [conv, CR]), /row-level security/);
  await rejects(as(BR, `insert into public.messages (conversation_id, sender_id, kind, body) values ($1, $2, 'system', 'fake system')`, [conv, BR]), /row-level security/);
  await rejects(as(X, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'intrusion')`, [conv, X]), /row-level security/);
  assert.equal((await rows(X, `select * from public.messages`)).length, 0);
  assert.equal((await rows(X, `select * from public.conversations`)).length, 0);
  assert.equal((await rows(X, `select * from public.list_conversations()`)).length, 0);
  const msgs = await rows(CR, `select body from public.messages where conversation_id = $1 and kind = 'text'`, [conv]);
  assert.equal(msgs[0].body, 'Hi Kavya! Can we plan the first stream?');  // trimmed
  let inbox = await rows(CR, `select other_name, unread, last_body from public.list_conversations()`);
  assert.equal(inbox[0].other_name, 'Nova Brands'); assert.equal(inbox[0].unread, 1);
  assert.equal((await notifs(CR, 'new_message')).length, 1);
  await as(BR, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'Second message')`, [conv, BR]);
  assert.equal((await notifs(CR, 'new_message')).length, 1);  // grouped per hour
  await as(CR, `select public.mark_conversation_read($1)`, [conv]);
  inbox = await rows(CR, `select unread from public.list_conversations()`);
  assert.equal(inbox[0].unread, 0);
  assert.equal((await rows(CR, `select id from public.notifications where kind = 'new_message' and read_at is null`)).length, 0);
  await rejects(as(X, `select public.mark_conversation_read($1)`, [conv]), /not found/);
  await rejects(as(X, `select public.start_conversation($1)`, [ADM]), /not available/);  // admin isn't a published member
  const upd = await as(BR, `update public.messages set body = 'edited' where conversation_id = $1`, [conv]);
  assert.equal(upd.affectedRows, 0);  // messages are immutable
});

test('connections: request, no duplicates/self, accept, withdraw, mutual requests auto-accept', async () => {
  const req = (await one(BR, `select public.request_connection($1) r`, [CR])).r;
  assert.equal(req.status, 'pending');
  await rejects(as(BR, `select public.request_connection($1)`, [CR]), /already pending/);
  await rejects(as(BR, `select public.request_connection($1)`, [BR]), /yourself/);
  await rejects(as(CR, `select public.request_connection($1)`, [X]), /not available/);
  await rejects(as(BR, `insert into public.connections (requester_id, addressee_id, status) values ($1, $2, 'accepted')`, [BR, X]), /row-level security/);
  assert.equal((await notifs(CR, 'connection_request')).length, 1);
  await rejects(as(BR, `select public.respond_connection($1, 'accept')`, [req.id]), /Only the recipient/);
  await rejects(as(X, `select public.respond_connection($1, 'accept')`, [req.id]), /not found/);
  assert.equal((await rows(X, `select * from public.connections`)).length, 0);
  await as(CR, `select public.respond_connection($1, 'accept')`, [req.id]);
  assert.equal((await notifs(BR, 'connection_accepted')).length, 1);
  assert.equal((await one(BR, `select public.get_member_profile($1) p`, [CR])).p.connection.status, 'accepted');
  assert.equal((await one(CR, `select public.request_connection($1) r`, [BR])).r.status, 'accepted');  // already connected
  await as(CR, `select public.respond_connection($1, 'withdraw')`, [req.id]);
  assert.equal((await one(BR, `select public.get_member_profile($1) p`, [CR])).p.connection, null);
  // mutual: CR asks, then BR asks back -> accepted, no duplicate rows
  await as(CR, `select public.request_connection($1)`, [BR]);
  assert.equal((await one(BR, `select public.request_connection($1) r`, [CR])).r.status, 'accepted');
  assert.equal((await db.query(`select count(*)::int n from public.connections where status in ('pending','accepted')`)).rows[0].n, 1);
  const a = (await one(ADM, `select public.admin_analytics() a`)).a;
  assert.equal(a.connections.accepted, 1); assert.equal(a.collaborations.completed, 1); assert.equal(a.messages, 2);
});

test('list functions return only the caller\'s own connections and requests', async () => {
  const mine = await rows(CR, `select other_name, status, direction from public.list_connections()`);
  assert.deepEqual(mine.map(r => [r.other_name, r.status]), [['Nova Brands', 'accepted']]);
  assert.equal((await rows(X, `select * from public.list_connections()`)).length, 0);
  const reqs = await rows(CR, `select direction, other_name, subject, status, conversation_id from public.list_collaboration_requests()`);
  assert.equal(reqs.length, 2);
  assert.ok(reqs.every(r => r.direction === 'incoming' && r.other_name === 'Nova Brands'));
  assert.ok(reqs.some(r => r.status === 'completed' && r.conversation_id));
  assert.equal((await rows(X, `select * from public.list_collaboration_requests()`)).length, 0);
  await rejects(as('anon', `select * from public.list_connections()`), /permission denied/);
});

test('suspended or pending accounts cannot message, request or connect', async () => {
  await as(ADM, `select public.admin_set_user_status($1, 'suspended', 'test')`, [BR]);
  await rejects(as(BR, `select public.request_connection($1)`, [CR]), /account_not_active/);
  await rejects(as(BR, `select public.start_conversation($1)`, [CR]), /account_not_active/);
  const conv = (await db.query(`select id from public.conversations limit 1`)).rows[0].id;
  await rejects(as(BR, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'still here?')`, [conv, BR]), /account_not_active/);
  assert.equal((await rows(CR, `select name from public.list_members('brand')`)).length, 0);  // hidden from directory
  await as(ADM, `select public.admin_set_user_status($1, 'active')`, [BR]);
});

test('retention purge removes only old login events and is server-only', async () => {
  await db.query(`insert into public.login_events (status, source, occurred_at) values ('success', 'auth', now() - interval '400 days')`);
  await rejects(as(ADM, `select public.purge_login_events()`), /permission denied/);
  const before = (await db.query(`select count(*)::int n from public.login_events`)).rows[0].n;
  assert.equal((await db.query(`select public.purge_login_events() n`)).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int n from public.login_events`)).rows[0].n, before - 1);
});
