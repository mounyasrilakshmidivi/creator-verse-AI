/* Backend: Supabase Auth + Postgres (RLS) + Edge Functions.
   Only public values (project URL, anon key) reach the browser; every write is checked by
   Row Level Security and database triggers, and payments are verified server-side. */
class QuotaError extends Error {
  constructor(feature, info = {}) { super(`quota_exceeded:${feature}`); this.feature = feature; this.info = info; }
}

const Backend = (() => {
  const st = { initializing: true, configured: false, sb: null, session: null, profile: null, plan: null, settings: {}, providers: {}, error: null };
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  const origin = () => location.origin;

  // ---------- errors ----------
  function fail(error) {
    if (!error) return;
    const msg = error.message || String(error);
    if (isMissingSchema(error)) {
      const e = new Error('The CreatorVerse database is not set up yet, so this feature is unavailable. Site owner: run the SQL files in supabase/migrations in the Supabase SQL Editor (see SETUP.md).');
      e.raw = error; e.dbMissing = true;
      throw e;
    }
    if (/account_not_active/.test(msg)) {
      const why = { pending: 'Your account is waiting for administrator approval.', rejected: 'Your registration was not approved.', suspended: 'Your account is suspended.' }[error.hint];
      const e = new Error(`${why || 'Your account is not active.'} This action is unavailable until an administrator activates your account.`);
      e.raw = error;
      throw e;
    }
    if (/admin_only/.test(msg)) { const e = new Error('Only administrators can do that.'); e.raw = error; throw e; }
    const q = /quota_exceeded:(\w+)/.exec(msg);
    if (q) throw new QuotaError(q[1], { limit: error.hint ? +error.hint : null });
    const friendly = {
      'Invalid login credentials': 'Incorrect email or password.',
      'Email not confirmed': 'Please verify your email first. Check your inbox, or resend the verification email.',
      'User already registered': 'An account with this email already exists. Try logging in instead.',
      'Token has expired or is invalid': 'That code or link is incorrect or has expired. Request a new verification email.',
    }[msg]
      || (/failed to fetch|networkerror|load failed|fetch failed/i.test(msg) || error.name === 'AuthRetryableFetchError'
        ? "Can't reach the sign-in server. Check your internet connection and that SUPABASE_URL in .env is correct, then try again." : null)
      || (/database error saving new user/i.test(msg)
        ? 'The account could not be created because the database is not set up correctly. The site owner needs to apply the SQL in supabase/migrations (see SETUP.md).' : null)
      || (/rate limit/i.test(msg)
        ? 'Too many emails were requested. Please wait a few minutes and try again. (Site owner: configure custom SMTP in Supabase, see SETUP.md.)' : null)
      || (/invalid api key|no api key/i.test(msg)
        ? 'Sign-in is misconfigured: SUPABASE_ANON_KEY in .env is not valid for this project.' : null);
    const e = new Error(friendly || msg);
    if (/row-level security|permission denied/i.test(msg)) e.message = 'You are not allowed to do that.';
    if (/JWT|session/i.test(msg) && /expired|missing|invalid/i.test(msg)) e.message = 'Your session expired. Please log in again.';
    e.raw = error;
    throw e;
  }
  const must = async promise => { const { data, error } = await promise; fail(error); return data; };

  // ---------- init ----------
  async function init() {
    st.initializing = true;
    try { return await initInner(); } finally { st.initializing = false; }
  }

  async function initInner() {
    let cfg = {};
    try {
      const r = await fetch('/api/config', { cache: 'no-store' });
      if (r.ok) cfg = await r.json();
    } catch { /* static hosting without the config endpoint */ }
    // Accept a pasted API endpoint (…/rest/v1/) and keep only the project base URL
    if (cfg.supabaseUrl) cfg.supabaseUrl = cfg.supabaseUrl.trim().replace(/\/(rest|auth|storage|functions)\/v1\/?.*$/, '').replace(/\/+$/, '');
    // Same check on the client, so hosts other than serve.ps1 (e.g. Vercel) are covered too
    const placeholder = /your-project-ref/i.test(cfg.supabaseUrl || '') || /^your-/i.test(cfg.supabaseAnonKey || '');
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || placeholder || !window.supabase) {
      st.error = {
        no_env_file: 'There is no .env file in the project folder. Copy .env.example to .env and set SUPABASE_URL and SUPABASE_ANON_KEY.',
        env_txt: 'Found ".env.txt" instead of ".env". Windows hid the .txt extension; rename the file to exactly .env.',
        empty: 'SUPABASE_URL and/or SUPABASE_ANON_KEY are empty in .env.',
        placeholder: '.env still contains the example placeholder values. Replace them with your project URL and anon key from Supabase > Project Settings > API.',
        invalid_url: 'SUPABASE_URL in .env is not a valid URL. It should look like https://your-project-ref.supabase.co',
      }[placeholder ? 'placeholder' : cfg.configProblem]
        || (cfg.supabaseUrl === undefined
          ? 'The site could not load /api/config. Start it with serve.ps1 (npm start / start.bat) or deploy it with api/config.js; opening index.html directly or using another static server cannot provide the configuration.'
          : !window.supabase ? 'The Supabase library failed to load (js/vendor/supabase-2.45.4.js).'
          : 'SUPABASE_URL and/or SUPABASE_ANON_KEY are not set. On Vercel, add them under Project Settings > Environment Variables and redeploy.');
      return st;
    }
    try {
      st.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    } catch (err) {
      st.error = `SUPABASE_URL in .env is not valid (${err.message}). It should look like https://your-project-ref.supabase.co`;
      return st;
    }
    st.configured = true;
    st.appBaseUrl = cfg.appBaseUrl || origin();
    const urlResult = await handleAuthRedirect();
    const { data } = await st.sb.auth.getSession();
    st.session = data.session;
    st.sb.auth.onAuthStateChange((event, session) => {
      const changedUser = session?.user?.id !== st.session?.user?.id;
      st.session = session;
      if (event === 'SIGNED_OUT') { st.profile = null; st.plan = null; emit(); }
      else if (changedUser || event === 'USER_UPDATED') loadMe().then(emit);
    });
    await Promise.all([loadMe(), loadSettings(), loadProviders(cfg)]);
    st.urlResult = urlResult;
    return st;
  }

  // Email links use ?token_hash=...&type=... (works across devices); OAuth returns ?code=...
  async function handleAuthRedirect() {
    // supabase-js reads ?code= (OAuth / default email links) asynchronously after acquiring a lock,
    // so let it finish before we inspect or clean the URL; otherwise the code exchange never happens.
    await st.sb.auth.getSession();
    const q = new URLSearchParams(location.search);
    const hashErr = new URLSearchParams(location.hash.replace(/^#\/?[^?]*\??/, ''));
    const error = q.get('error_description') || hashErr.get('error_description');
    let result = null;
    if (q.get('unsubscribe')) result = { type: 'unsubscribe', token: q.get('unsubscribe') };
    else if (error) result = { error: error.replace(/\+/g, ' ') };
    else if (q.get('token_hash') && q.get('type')) {
      const type = q.get('type');
      const { error: e } = await st.sb.auth.verifyOtp({ token_hash: q.get('token_hash'), type });
      result = e ? { error: e.message.includes('expired') ? 'This link has expired or was already used. Request a new one.' : e.message } : { type };
    } else if (q.get('code')) {
      // supabase-js already exchanged the code above (Google sign-in or a default-template email link)
      const { data } = await st.sb.auth.getSession();
      result = data.session ? { type: 'code' }
        : { error: 'Sign-in could not be completed. If you opened the link in a different browser, open it in the one you signed up with, or just log in.' };
    }
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    return result;
  }

  async function loadMe() {
    if (!st.session) { st.profile = null; st.plan = null; return; }
    const uid = st.session.user.id;
    const [p, plan] = await Promise.all([
      st.sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
      st.sb.rpc('my_plan'),
    ]);
    st.profile = p.data;
    st.plan = plan.data;
    // Tables/functions missing = the SQL migrations haven't been applied to this Supabase project.
    // Auth still works, but profile data can't load; the UI explains this instead of failing.
    st.dbMissing = isMissingSchema(p.error) || isMissingSchema(plan.error);
  }
  const isMissingSchema = e => !!e && (['PGRST205', 'PGRST202', '42P01', '42883'].includes(e.code)
    || /could not find the (table|function)|does not exist|schema cache/i.test(e.message || ''));
  async function loadSettings() {
    const { data } = await st.sb.from('app_settings').select('key, value');
    st.settings = Object.fromEntries((data || []).map(r => [r.key, r.value]));
  }
  // GoTrue reports which OAuth providers are enabled, so the UI never shows a dead Google button.
  async function loadProviders(cfg) {
    try {
      const r = await fetch(`${cfg.supabaseUrl}/auth/v1/settings`, { headers: { apikey: cfg.supabaseAnonKey } });
      st.providers = (await r.json()).external || {};
    } catch { st.providers = {}; }
  }
  async function refresh() { await loadMe(); emit(); return st; }

  // ---------- auth ----------
  const redirect = route => `${st.appBaseUrl || origin()}/${route ? `#/${route}` : ''}`;
  const auth = {
    signUp: async ({ name, email, password, accountType, marketingOptIn = false }) => must(st.sb.auth.signUp({
      email, password, options: { data: { full_name: name, account_type: accountType, marketing_opt_in: !!marketingOptIn }, emailRedirectTo: redirect('dashboard') },
    })),
    signIn: async ({ email, password }) => must(st.sb.auth.signInWithPassword({ email, password })),
    google: async () => must(st.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: st.appBaseUrl || origin() } })),
    signOut: async () => { await st.sb.auth.signOut(); st.session = null; st.profile = null; st.plan = null; emit(); },
    resendVerification: async email => must(st.sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirect('dashboard') } })),
    verifyCode: async (email, token) => must(st.sb.auth.verifyOtp({ email, token, type: 'email' })),
    sendReset: async email => must(st.sb.auth.resetPasswordForEmail(email, { redirectTo: redirect('reset') })),
    updatePassword: async password => must(st.sb.auth.updateUser({ password })),
    updateEmail: async email => must(st.sb.auth.updateUser({ email }, { emailRedirectTo: redirect('account') })),
  };

  // ---------- data (all protected by RLS) ----------
  const uid = () => st.session?.user?.id;
  const sb = () => st.sb;
  const db = {
    updateProfile: async patch => { const d = await must(sb().from('profiles').update(patch).eq('id', uid()).select().single()); st.profile = d; emit(); return d; },
    brandProfile: async () => must(sb().from('brand_profiles').select('*').eq('user_id', uid()).maybeSingle()),
    saveBrandProfile: async p => must(sb().from('brand_profiles').upsert({ ...p, user_id: uid(), updated_at: new Date().toISOString() }).select().single()),
    creatorProfile: async () => must(sb().from('creator_profiles').select('*, creator_social_links(platform, url)').eq('user_id', uid()).maybeSingle()),
    saveCreatorProfile: async (p, links) => {
      const row = await must(sb().from('creator_profiles').upsert({ ...p, user_id: uid(), updated_at: new Date().toISOString() }).select().single());
      await must(sb().from('creator_social_links').delete().eq('user_id', uid()));
      if (links.length) await must(sb().from('creator_social_links').insert(links.map(l => ({ ...l, user_id: uid() }))));
      return row;
    },
    savedIds: async () => (await must(sb().from('saved_creators').select('creator_ref').order('created_at'))).map(r => r.creator_ref),
    save: async ref => { await must(sb().from('saved_creators').insert({ user_id: uid(), creator_ref: ref })); },
    unsave: async ref => { await must(sb().from('saved_creators').delete().eq('user_id', uid()).eq('creator_ref', ref)); },
    openCampaigns: async () => must(sb().from('campaigns').select('*').in('status', ['open', 'in_review']).order('created_at', { ascending: false }).limit(100)),
    myCampaigns: async () => must(sb().from('campaigns').select('*, applications(*)').eq('owner_id', uid()).order('created_at', { ascending: false })),
    createCampaign: async c => must(sb().from('campaigns').insert({ ...c, owner_id: uid() }).select().single()),
    updateCampaign: async (id, patch) => must(sb().from('campaigns').update(patch).eq('id', id).select().single()),
    myApplications: async () => must(sb().from('applications').select('*, campaigns(title, brand_name, status)').eq('creator_id', uid()).order('created_at', { ascending: false })),
    apply: async (campaign_id, rate, pitch) => must(sb().from('applications').insert({ campaign_id, creator_id: uid(), rate, pitch }).select().single()),
    setApplicationStatus: async (id, status) => must(sb().from('applications').update({ status }).eq('id', id).select().single()),
    requests: async () => must(sb().from('collab_requests').select('*').order('created_at', { ascending: false })),
    sendRequest: async r => must(sb().from('collab_requests').insert({ ...r, brand_id: uid() }).select().single()),
    notifications: async (limit = 50) => must(sb().from('notifications').select('*').order('created_at', { ascending: false }).limit(limit)),
    markRead: async ids => must(sb().from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).is('read_at', null)),
    prefs: async () => must(sb().from('notification_prefs').select('*').eq('user_id', uid()).maybeSingle()),
    savePrefs: async p => must(sb().from('notification_prefs').upsert({ ...p, user_id: uid(), updated_at: new Date().toISOString() })),
    plans: async () => must(sb().from('plans').select('*').order('sort_order')),
    limits: async () => must(sb().from('plan_limits').select('*').order('tier').order('feature')),
    settings: async () => must(sb().from('app_settings').select('*').order('key')),
    // member network (all access rules are enforced in the database)
    listMembers: async ({ role = null, search = null, niche = null, limit = 24, offset = 0 } = {}) =>
      must(sb().rpc('list_members', { p_role: role, p_search: search || null, p_niche: niche, p_limit: limit, p_offset: offset })),
    memberProfile: async id => must(sb().rpc('get_member_profile', { p_user: id })),
    requestConnection: async id => must(sb().rpc('request_connection', { p_user: id })),
    respondConnection: async (id, action) => must(sb().rpc('respond_connection', { p_id: id, p_action: action })),
    connections: async () => must(sb().rpc('list_connections')),
    sendCollaboration: async r => must(sb().from('collaboration_requests').insert({ ...r, sender_id: uid() }).select('id, status').single()),
    respondCollaboration: async (id, action, note = null) => must(sb().rpc('respond_collaboration', { p_id: id, p_action: action, p_note: note })),
    collaborations: async () => must(sb().rpc('list_collaboration_requests')),
    startConversation: async userId => must(sb().rpc('start_conversation', { p_user: userId })),
    conversations: async () => must(sb().rpc('list_conversations')),
    messages: async (conversationId, limit = 200) => (await must(sb().from('messages').select('id, sender_id, kind, body, created_at')
      .eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(limit))).reverse(),
    sendMessage: async (conversationId, body) => must(sb().from('messages').insert({ conversation_id: conversationId, sender_id: uid(), body }).select().single()),
    markConversationRead: async id => must(sb().rpc('mark_conversation_read', { p_conversation: id })),
    saveCreatorStats: async s => must(sb().from('creator_stats').upsert({ ...s, user_id: uid(), updated_at: new Date().toISOString() })),
    creatorStats: async () => must(sb().from('creator_stats').select('*').eq('user_id', uid()).maybeSingle()),
    // admin analytics
    adminLoginEvents: async ({ from = null, to = null, role = null, status = null, search = null, limit = 50, offset = 0 } = {}) =>
      must(sb().rpc('admin_login_events', { p_from: from, p_to: to, p_role: role, p_status: status, p_search: search || null, p_limit: limit, p_offset: offset })),
    adminAnalytics: async (from = null, to = null) => must(sb().rpc('admin_analytics', { p_from: from, p_to: to })),
    adminLoginReport: async (from, to, role = null) => must(sb().rpc('admin_login_report', { p_from: from, p_to: to, p_role: role })),
    adminCampaignAudience: async audience => must(sb().rpc('admin_campaign_audience', { p_audience: audience })),
    adminSaveCampaign: async (id, audience, subject, body) => must(sb().rpc('admin_save_campaign', { p_id: id, p_audience: audience, p_subject: subject, p_body: body })),
    adminSendCampaignTest: async id => must(sb().rpc('admin_send_campaign_test', { p_id: id })),
    adminLaunchCampaign: async (id, confirm) => must(sb().rpc('admin_launch_campaign', { p_id: id, p_confirm: confirm })),
    adminCampaigns: async () => must(sb().rpc('admin_list_campaigns')),
    // admin-only (each function re-checks app_admins on the server)
    adminStats: async () => must(sb().rpc('admin_stats')),
    adminListUsers: async (status = null, search = null) => must(sb().rpc('admin_list_users', { p_status: status, p_search: search || null })),
    adminSetUserStatus: async (user, status, reason = null) => must(sb().rpc('admin_set_user_status', { p_user: user, p_status: status, p_reason: reason })),
    // admin-only (RLS rejects everyone else)
    adminUpdatePlan: async (id, patch) => must(sb().from('plans').update(patch).eq('id', id).select().single()),
    adminUpdateLimit: async (tier, feature, patch) => must(sb().from('plan_limits').update(patch).eq('tier', tier).eq('feature', feature).select().single()),
    adminUpdateSetting: async (key, value) => must(sb().from('app_settings').update({ value }).eq('key', key).select().single()),
  };

  // Failed sign-ins aren't visible to the database inside Supabase Auth, so report them (no password is sent).
  async function reportLoginFailure(email, reason) {
    if (!st.sb) return;
    try { await st.sb.rpc('record_login_failure', { p_email: email, p_reason: reason }); } catch { /* analytics must never block login */ }
  }
  // One-click unsubscribe from marketing emails (works without signing in; the token comes from the email)
  async function unsubscribe(token) {
    if (!st.sb) throw new Error('Accounts are not connected on this site yet.');
    return must(st.sb.rpc('unsubscribe_marketing', { p_token: token }));
  }
  // "Last activity" for admin analytics (throttled on the server too)
  let lastTouch = 0;
  function touchActivity() {
    if (!st.session || Date.now() - lastTouch < 5 * 60 * 1000) return;
    lastTouch = Date.now();
    st.sb.rpc('touch_activity').then(() => {}, () => {});
  }
  // Live inserts for my messages/notifications (Supabase Realtime applies RLS); returns an unsubscribe function
  function subscribe(onMessage, onNotification) {
    if (!st.sb || !st.session) return () => {};
    const ch = st.sb.channel('cverse-inbox-' + st.session.user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => onMessage?.(p.new))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${st.session.user.id}` }, p => onNotification?.(p.new))
      .subscribe();
    return () => { st.sb.removeChannel(ch); };
  }

  // Server-counted usage for actions that happen in the browser. Returns status; throws QuotaError when denied.
  async function consume(feature) {
    let data;
    try { data = await must(sb().rpc('consume_quota', { p_feature: feature })); }
    catch (err) {
      // No CreatorVerse tables yet means no plans or limits exist: let the signed-in user through instead of blocking.
      if (err.dbMissing) return { allowed: true, unmetered: true };
      throw err;
    }
    if (!data.allowed) throw new QuotaError(feature, data);
    if (st.plan?.usage) {
      const u = st.plan.usage.find(x => x.feature === feature);
      if (u) u.used = data.used;
    }
    return data;
  }

  // Edge Function call with a readable error
  async function fn(name, body = {}) {
    const { data, error } = await sb().functions.invoke(name, { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); msg = j.error || msg; } catch { /* not JSON */ }
      if (/Failed to send a request|FunctionsFetchError/i.test(msg)) msg = 'Could not reach the payment server. The Edge Functions may not be deployed yet.';
      throw new Error(msg);
    }
    return data;
  }

  return {
    init, refresh, auth, db, consume, fn, QuotaError, reportLoginFailure, touchActivity, subscribe, unsubscribe,
    on: f => (listeners.add(f), () => listeners.delete(f)),
    get configured() { return st.configured; },
    get initializing() { return st.initializing; },
    get dbMissing() { return !!st.dbMissing; },
    // 'active' when the approval migration isn't applied yet (no status column) or for admins
    get accountStatus() { return st.plan?.is_admin ? 'active' : (st.profile?.status || 'active'); },
    get configError() { return st.error || null; },
    get session() { return st.session; },
    get user() { return st.session?.user || null; },
    get verified() { return !!st.session?.user?.email_confirmed_at; },
    get profile() { return st.profile; },
    get plan() { return st.plan; },
    get tier() { return st.plan?.tier || 'free'; },
    get isAdmin() { return !!st.plan?.is_admin; },
    get settings() { return st.settings; },
    get googleEnabled() { return !!st.providers.google; },
    get urlResult() { return st.urlResult; },
    clearUrlResult() { st.urlResult = null; },
  };
})();
