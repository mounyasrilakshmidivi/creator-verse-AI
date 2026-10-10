// DEV ONLY: in-memory stand-in for supabase-js, used to smoke-test the signed-in UI in a browser
// without a Supabase project. It does NOT implement RLS or triggers (see tests/db.test.mjs for those).
// Usage (browser console on the running site): paste this file, then `await __mockBoot('brand')`.
(() => {
  const now = () => new Date().toISOString();
  const uid = 'aaaaaaaa-0000-0000-0000-000000000001';
  const FREE = { profile_view: 10, search: 5, ai_match: 3, campaign: 1, saved_creator: 5 };
  const T = {
    profiles: [{ id: uid, full_name: 'Mock Brand Co', role: null, avatar_url: null }],
    plans: [
      { id: 'free', tier: 'free', name: 'Free', description: 'Starter', price_inr: 0, billing_interval: null, razorpay_plan_id: null, features: ['5 searches / month'], is_active: true, sort_order: 0 },
      { id: 'premium_monthly', tier: 'premium', name: 'Premium Monthly', description: 'Monthly', price_inr: 999, billing_interval: 'month', razorpay_plan_id: 'plan_MOCK1', features: ['500 searches / month', 'Advanced filters'], is_active: true, sort_order: 1 },
      { id: 'premium_yearly', tier: 'premium', name: 'Premium Yearly', description: 'Yearly', price_inr: 9990, billing_interval: 'year', razorpay_plan_id: null, features: ['500 searches / month'], is_active: true, sort_order: 2 },
    ],
    plan_limits: Object.entries(FREE).map(([feature, limit_value]) => ({ tier: 'free', feature, limit_value, period: feature === 'saved_creator' ? 'lifetime' : 'month' })),
    app_settings: [{ key: 'advanced_filters_premium_only', value: true, description: '' }, { key: 'prices_are_samples', value: true, description: '' }, { key: 'usage_warning_ratio', value: 0.8, description: '' }],
    notifications: [], saved_creators: [], campaigns: [], applications: [], collab_requests: [], notification_prefs: [{ user_id: uid, email_activity: true, email_usage: true, email_billing: true }],
    brand_profiles: [], creator_profiles: [], creator_social_links: [], subscriptions: [],
    mockUsers: [
      { id: 'u1', email: 'priya.brand@example.test', full_name: 'Priya Foods', role: 'brand', status: 'pending', created_at: now(), email_confirmed_at: now(), is_admin: false },
      { id: 'u2', email: 'ravi.creator@example.test', full_name: 'Ravi K', role: 'creator', status: 'pending', created_at: now(), email_confirmed_at: now(), is_admin: false },
      { id: 'u3', email: 'active.user@example.test', full_name: 'Active User', role: 'brand', status: 'active', created_at: now(), email_confirmed_at: now(), is_admin: false },
    ],
  };
  // Test fixtures for the admin analytics / campaign UI (generated, clearly fake .test addresses)
  T.mockUsers[0].optin = true; T.mockUsers[2].optin = true;
  T.mockUsers[1].created_at = new Date(Date.now() - 40 * 864e5).toISOString();
  T.emailCampaigns = [];
  T.loginEvents = [];
  for (let i = 0; i < 1500; i++) {
    const u = T.mockUsers[i % 3], fail = i % 7 === 0, t = new Date(Date.now() - (i / 1500) * 60 * 864e5 - 3600e3);
    T.loginEvents.push({ event_id: crypto.randomUUID(), user_id: u.id, user_name: u.full_name, email: u.email, user_role: u.role, status: fail ? 'failure' : 'success',
      failure_reason: fail ? 'invalid_credentials' : null, method: 'password', source: fail ? 'client_report' : 'auth', occurred_at: t.toISOString(), account_created_at: u.created_at, last_activity: now() });
  }
  const used = {};
  // accounts persist in localStorage so "refresh the page" can be tested like supabase-js's persisted session
  const accounts = JSON.parse(localStorage.getItem('mock-accounts') || '{}');
  const saveAccounts = () => localStorage.setItem('mock-accounts', JSON.stringify(accounts));
  let session = JSON.parse(localStorage.getItem('mock-session') || 'null'), cb = null, tier = 'free', offline = false, isAdmin = true;
  setInterval(saveAccounts, 200);
  const notify = (kind, title) => T.notifications.unshift({ id: crypto.randomUUID(), user_id: uid, kind, title, body: '', link: '#/dashboard', read_at: null, created_at: now() });

  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.one = 0; this.sel = '*'; }
    select(s = '*') { if (this.op === 'select') this.sel = s; else this.ret = true; return this; }
    eq(k, v) { this.f.push(r => r[k] === v); return this; }
    in(k, a) { this.f.push(r => a.includes(r[k])); return this; }
    is(k, v) { this.f.push(r => (r[k] ?? null) === v); return this; }
    order() { return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.one = 1; return this; }
    single() { this.one = 2; return this; }
    insert(r) { this.op = 'insert'; this.rows = [].concat(r); return this; }
    upsert(r) { this.op = 'upsert'; this.rows = [].concat(r); return this; }
    update(p) { this.op = 'update'; this.patch = p; return this; }
    delete() { this.op = 'delete'; return this; }
    then(res, rej) { try { res(this.exec()); } catch (e) { rej(e); } }
    exec() {
      const tbl = T[this.t];
      const match = () => tbl.filter(r => this.f.every(fn => fn(r)));
      let data;
      if (this.op === 'insert') {
        if (this.t === 'saved_creators' && tier === 'free' && tbl.length >= FREE.saved_creator) return { data: null, error: { message: 'quota_exceeded:saved_creator', hint: String(FREE.saved_creator) } };
        if (this.t === 'campaigns') {
          if (tier === 'free' && (used.campaign || 0) >= FREE.campaign) return { data: null, error: { message: 'quota_exceeded:campaign', hint: '1' } };
          used.campaign = (used.campaign || 0) + 1;
        }
        data = this.rows.map(r => ({ id: crypto.randomUUID(), created_at: now(), status: this.t === 'collab_requests' ? 'sent' : 'open', brand_name: 'Mock Brand Co', ...r }));
        tbl.push(...data);
        if (this.t === 'campaigns') notify('campaign_created', `Campaign "${data[0].title}" is live`);
        if (this.t === 'collab_requests') notify('request_sent', `Collaboration request sent to ${data[0].creator_name}`);
      } else if (this.op === 'upsert') {
        data = this.rows.map(r => { const key = r.user_id ? 'user_id' : 'id'; const ex = tbl.find(x => x[key] === r[key]); if (ex) return Object.assign(ex, r); tbl.push(r); return r; });
      } else if (this.op === 'update') {
        data = match().map(r => Object.assign(r, this.patch));
      } else if (this.op === 'delete') {
        data = match(); data.forEach(r => tbl.splice(tbl.indexOf(r), 1));
      } else {
        data = match().map(r => ({ ...r }));
        if (this.t === 'campaigns' && this.sel.includes('applications')) data.forEach(c => { c.applications = T.applications.filter(a => a.campaign_id === c.id); });
        if (this.t === 'creator_profiles' && this.sel.includes('creator_social_links')) data.forEach(c => { c.creator_social_links = T.creator_social_links.filter(l => l.user_id === c.user_id); });
      }
      if (this.lim) data = data.slice(0, this.lim);
      if (this.one) data = data[0] ?? null;
      if (this.one === 2 && !data) return { data: null, error: { message: 'Row not found' } };
      return { data, error: null };
    }
  }

  const myPlan = () => ({
    tier, is_admin: isAdmin,
    subscription: T.subscriptions[0] || null,
    usage: Object.entries(FREE).map(([feature, limit]) => ({ feature, limit: tier === 'premium' ? null : limit, period: feature === 'saved_creator' ? 'lifetime' : 'month',
      resets_at: new Date(Date.now() + 20 * 864e5).toISOString(), used: feature === 'saved_creator' ? T.saved_creators.length : used[feature] || 0 })),
  });

  const client = {
    from: t => new Q(t),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: async () => {},
    rpc: async (fn, args) => {
      if (fn === 'my_plan') return { data: myPlan(), error: null };
      if (fn === 'admin_stats') return { data: { users: T.mockUsers.length, pending: T.mockUsers.filter(u => u.status === 'pending').length, active: T.mockUsers.filter(u => u.status === 'active').length, brands: 2, creators: 1, campaigns: T.campaigns.length, premium: 0, emails_failed: 0 }, error: null };
      if (fn === 'admin_list_users') return { data: T.mockUsers.filter(u => !args.p_status || u.status === args.p_status).filter(u => !args.p_search || (u.email + u.full_name).includes(args.p_search)), error: null };
      if (fn === 'admin_set_user_status') { const u = T.mockUsers.find(x => x.id === args.p_user); u.status = args.p_status; u.status_reason = args.p_reason || null; return { data: null, error: null }; }
      if (fn === 'consume_quota') {
        const f = args.p_feature, lim = tier === 'premium' ? null : FREE[f];
        if (lim != null && (used[f] || 0) >= lim) return { data: { allowed: false, feature: f, used: used[f], limit: lim, period: 'month', resets_at: new Date(Date.now() + 20 * 864e5).toISOString() }, error: null };
        used[f] = (used[f] || 0) + 1;
        if (lim != null && used[f] === lim) notify('limit_reached', `You've used all your ${f}`);
        return { data: { allowed: true, feature: f, used: used[f], limit: lim, remaining: lim == null ? null : lim - used[f] }, error: null };
      }
      if (fn === 'admin_login_events') {
        const rows = T.loginEvents.filter(e => e.occurred_at >= args.p_from && e.occurred_at < args.p_to && (!args.p_role || e.user_role === args.p_role)
          && (!args.p_status || e.status === args.p_status) && (!args.p_search || (e.email + e.user_name).includes(args.p_search)));
        return { data: rows.slice(args.p_offset, args.p_offset + args.p_limit).map(r => ({ ...r, total_count: rows.length })), error: null };
      }
      if (fn === 'admin_login_report') {
        const from = new Date(args.p_from), to = new Date(args.p_to), span = to - from, inR = (e, a, b) => new Date(e.occurred_at) >= a && new Date(e.occurred_at) < b;
        const ev = T.loginEvents.filter(e => !args.p_role || e.user_role === args.p_role), users = T.mockUsers.filter(u => !args.p_role || u.role === args.p_role);
        const cur = ev.filter(e => inR(e, from, to)), prev = ev.filter(e => inR(e, new Date(from - span), from));
        const days = []; for (let d = new Date(from); d < to; d = new Date(d.getTime() + 864e5)) {
          const nx = new Date(d.getTime() + 864e5), de = cur.filter(e => inR(e, d, nx));
          days.push({ day: d.toISOString().slice(0, 10), success: de.filter(e => e.status === 'success').length, failure: de.filter(e => e.status === 'failure').length,
            active_users: new Set(de.filter(e => e.status === 'success').map(e => e.user_id)).size, registrations: users.filter(u => new Date(u.created_at) >= d && new Date(u.created_at) < nx).length });
        }
        const ok = cur.filter(e => e.status === 'success');
        return { data: {
          timezone: 'Asia/Kolkata', from: args.p_from, to: args.p_to, previous_period_complete: true, history_available_from: T.loginEvents.at(-1)?.occurred_at || null,
          summary: { users_total: users.length, creators: users.filter(u => u.role === 'creator').length, brands: users.filter(u => u.role === 'brand').length, no_role: users.filter(u => !u.role).length,
            successful_logins: ok.length, failed_logins: cur.length - ok.length, unique_users: new Set(ok.map(e => e.user_id)).size,
            never_logged_in: users.filter(u => !ev.some(e => e.user_id === u.id && e.status === 'success')).length, ever_logged_in: users.filter(u => ev.some(e => e.user_id === u.id && e.status === 'success')).length,
            new_registrations: users.filter(u => new Date(u.created_at) >= from).length },
          previous: { successful_logins: prev.filter(e => e.status === 'success').length, failed_logins: prev.filter(e => e.status === 'failure').length },
          daily: days,
          roles: ['creator', 'brand'].filter(r => !args.p_role || r === args.p_role).map(r => ({ role: r, registered: users.filter(u => u.role === r).length,
            success: ok.filter(e => e.user_role === r).length, failure: cur.filter(e => e.status === 'failure' && e.user_role === r).length, unique_users: new Set(ok.filter(e => e.user_role === r).map(e => e.user_id)).size })),
          users: users.map(u => ({ user_id: u.id, name: u.full_name, email: u.email, role: u.role, registered_at: u.created_at, last_login: ev.find(e => e.user_id === u.id && e.status === 'success')?.occurred_at || null,
            last_activity: null, logins_in_period: ok.filter(e => e.user_id === u.id).length, failed_in_period: cur.filter(e => e.user_id === u.id && e.status === 'failure').length })),
          collaborations: { sent: 3, accepted: 1, declined: 1 },
        }, error: null };
      }
      if (fn === 'admin_campaign_audience') { const r = T.mockUsers.filter(u => args.p_audience === 'all' || u.role === args.p_audience); return { data: { eligible: r.filter(u => u.optin).length, registered: r.length, not_opted_in: r.filter(u => !u.optin).length }, error: null }; }
      if (fn === 'admin_save_campaign') {
        let c = T.emailCampaigns.find(x => x.id === args.p_id);
        if (!c) { c = { id: crypto.randomUUID(), status: 'draft', created_at: now(), recipient_count: 0, queued: 0, sent: 0, delivered: 0, failed: 0, bounced: 0, skipped: 0 }; T.emailCampaigns.unshift(c); }
        Object.assign(c, { audience: args.p_audience, subject: args.p_subject, body: args.p_body });
        return { data: c.id, error: null };
      }
      if (fn === 'admin_send_campaign_test') { T.emailCampaigns.find(x => x.id === args.p_id).test_sent_at = now(); return { data: true, error: null }; }
      if (fn === 'admin_launch_campaign') {
        if (args.p_confirm !== 'SEND') return { data: null, error: { message: 'Type SEND to confirm' } };
        const c = T.emailCampaigns.find(x => x.id === args.p_id), n = T.mockUsers.filter(u => u.optin && (c.audience === 'all' || u.role === c.audience)).length;
        Object.assign(c, { status: 'queued', launched_at: now(), recipient_count: n, queued: n });
        return { data: n, error: null };
      }
      if (fn === 'unsubscribe_marketing') return { data: /^[0-9a-f-]{36}$/.test(args.p_token), error: null };
      if (fn === 'admin_list_campaigns') return { data: T.emailCampaigns.map(c => ({ ...c })), error: null };
      return { data: null, error: { message: 'unknown rpc ' + fn } };
    },
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: fn => { cb = fn; return { data: { subscription: { unsubscribe() {} } } }; },
      // Mirrors Supabase Auth with "Confirm email" ON: duplicate sign-ups get a user with no identities,
      // unverified accounts can't sign in, and a 6-digit code (123456 here) verifies the email.
      signUp: async ({ email, password }) => {
        if (offline) return { data: {}, error: Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError' }) };
        if (accounts[email]) return { data: { user: { identities: [] }, session: null }, error: null };
        accounts[email] = { password, confirmed: false };
        return { data: { user: { identities: [{}] }, session: null }, error: null };
      },
      signInWithPassword: async ({ email, password }) => {
        if (offline) return { data: {}, error: Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError' }) };
        const a = accounts[email];
        if (!a || a.password !== password) return { data: {}, error: { message: 'Invalid login credentials' } };
        if (!a.confirmed) return { data: {}, error: { message: 'Email not confirmed' } };
        session = { user: { id: uid, email, email_confirmed_at: now(), app_metadata: { providers: ['email'] } } };
        try { localStorage.setItem('mock-session', JSON.stringify(session)); } catch { /* ignore */ }
        cb?.('SIGNED_IN', session); return { data: { session }, error: null };
      },
      signOut: async () => { session = null; localStorage.removeItem('mock-session'); cb?.('SIGNED_OUT', null); return { error: null }; },
      resend: async () => ({ data: {}, error: null }),
      verifyOtp: async ({ email, token }) => {
        if (token !== '123456' || !accounts[email]) return { data: {}, error: { message: 'Token has expired or is invalid' } };
        accounts[email].confirmed = true;
        session = { user: { id: uid, email, email_confirmed_at: now(), app_metadata: { providers: ['email'] } } };
        localStorage.setItem('mock-session', JSON.stringify(session));
        cb?.('SIGNED_IN', session); return { data: { session }, error: null };
      },
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: {}, error: null }),
      signInWithOAuth: async () => ({ data: {}, error: null }),
    },
    functions: {
      invoke: async name => {
        if (name === 'verify-subscription') {
          tier = 'premium';
          T.subscriptions = [{ id: 's1', plan_id: 'premium_monthly', status: 'active', current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(), cancel_at_period_end: false, provider_subscription_id: 'sub_MOCK' }];
          notify('subscription_active', 'Premium is active');
          return { data: { status: 'active', premium: true, message: 'Payment confirmed by Razorpay. Premium is active.' }, error: null };
        }
        if (name === 'cancel-subscription') { T.subscriptions[0].cancel_at_period_end = true; return { data: { ok: true }, error: null }; }
        return { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'This plan is not connected to Razorpay yet (mock).' }) } } };
      },
    },
  };

  window.__mock = { T, used, accounts, setTier: t => { tier = t; }, setOffline: v => { offline = v; }, setAdmin: v => { isAdmin = v; } };
  window.__mockBoot = async () => {
    const realFetch = window.fetch;
    window.fetch = (url, ...a) => String(url).startsWith('/api/config') ? Promise.resolve(new Response(JSON.stringify({ supabaseUrl: 'https://mock.supabase.co', supabaseAnonKey: 'anon', appBaseUrl: location.origin })))
      : String(url).includes('/auth/v1/settings') ? Promise.resolve(new Response(JSON.stringify({ external: { google: false } }))) : realFetch(url, ...a);
    window.supabase = { createClient: () => client };
    await Backend.init();
    App.route();
    return 'mock backend ready';
  };
})();
