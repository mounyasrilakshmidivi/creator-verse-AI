/* Member network: directory, profiles, collaboration requests, connections and real messaging.
   Everything is stored in Supabase; who can see or change what is enforced by RLS and database functions. */
const Social = (() => {
  const { NICHE_LABEL, CATEGORIES, PLATFORM_META } = DATA;
  const B = Backend;
  const fmt = d => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const initials = n => (n || '?').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const avatar = (url, name, size = 42) => (url
    ? `<img class="av" src="${esc(url)}" alt="" style="width:${size}px;height:${size}px">`
    : `<span class="av initials" style="width:${size}px;height:${size}px">${esc(initials(name))}</span>`);
  const STATUS_TONE = { pending: '', accepted: 'ok', completed: 'ok', declined: 'bad', cancelled: 'bad', withdrawn: 'bad' };
  const pill = s => `<span class="status-pill ${STATUS_TONE[s] || ''}">${esc(s)}</span>`;
  const head = (icon, badge, title, sub, actions = '') => `<section class="page-head"><div><span class="pill-badge"><i data-lucide="${icon}"></i>${badge}</span><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>${actions}</section>`;
  const loading = (h = 160) => `<div class="skeleton" style="height:${h}px"></div>`;
  const errBox = err => `<p class="form-msg">${esc(err.message || err)}</p>`;
  const empty = (icon, text, cta = '') => `<div class="empty-inline"><i data-lucide="${icon}"></i><p>${text}</p>${cta}</div>`;
  const myId = () => B.user?.id;

  /* ======================================================
     DISCOVER MEMBERS (#/members, #/members/creator, #/members/brand)
     ====================================================== */
  const dir = { role: null, search: '', niche: null, offset: 0, rows: [], total: 0 };
  function renderMembers(role) {
    dir.role = role === 'creator' || role === 'brand' ? role : null;
    dir.offset = 0; dir.rows = [];
    return `${head('users', 'Members', dir.role === 'creator' ? 'Discover creators' : dir.role === 'brand' ? 'Discover brands' : 'Discover members',
      'Creators and brands who have published their CreatorVerse AI profile. Only details they chose to share are shown.')}
      <div class="explore-bar">
        <div class="seg" id="mbRole">${[['', 'All'], ['creator', 'Creators'], ['brand', 'Brands']].map(([v, l]) => `<button type="button" data-v="${v}" class="${(dir.role || '') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <form class="search-sm" id="mbSearch" role="search"><i data-lucide="search"></i><input id="mbQ" value="${esc(dir.search)}" placeholder="Search name, city or bio" aria-label="Search members" /></form>
        <select id="mbNiche" aria-label="Niche"><option value="">All niches</option>${CATEGORIES.map(c => `<option value="${c.id}" ${dir.niche === c.id ? 'selected' : ''}>${NICHE_LABEL[c.id]}</option>`).join('')}</select>
      </div>
      <p class="sample-line"><span class="sample-note"><i data-lucide="info"></i>This directory lists real members. The featured creators on <a class="text-link" href="#/explore">Explore</a> are sample profiles.</span></p>
      <div class="member-grid" id="mbList">${loading(220)}</div>
      <div class="center" style="margin-top:16px"><button class="btn outline" id="mbMore" hidden>Load more</button></div>`;
  }
  async function loadMembers(append = false) {
    const box = $('#mbList'); if (!box) return;
    try {
      const rows = await B.db.listMembers({ role: dir.role, search: dir.search, niche: dir.niche, limit: 24, offset: dir.offset });
      dir.rows = append ? dir.rows.concat(rows) : rows;
      dir.total = rows[0] ? Number(rows[0].total_count) : (append ? dir.total : 0);
      box.innerHTML = dir.rows.length ? dir.rows.map(m => `
        <a class="member-card" href="#/u/${m.id}">
          ${avatar(m.avatar_url, m.name, 56)}
          <div><b>${esc(m.name)}</b><span class="status-pill">${m.role === 'creator' ? 'Creator' : 'Brand'}</span>
            <small class="muted">${esc([m.city, (m.niches || []).map(n => NICHE_LABEL[n]).join(', ')].filter(Boolean).join(' · '))}</small>
            <p>${esc(m.headline || '')}</p>
            ${m.availability ? `<small class="avail ${m.availability}">${{ open: 'Open to collaborations', limited: 'Limited availability', unavailable: 'Not available' }[m.availability]}</small>` : ''}</div>
        </a>`).join('') : empty('users', 'No members match yet. Members appear here after they publish their profile.');
      $('#mbMore').hidden = dir.rows.length >= dir.total;
      icons();
    } catch (err) { box.innerHTML = errBox(err); }
  }
  function wireMembers() {
    if (!$('#mbList')) return;
    loadMembers();
    $('#mbRole').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) location.hash = '#/members' + (b.dataset.v ? '/' + b.dataset.v : ''); });
    $('#mbSearch').addEventListener('submit', e => { e.preventDefault(); dir.search = $('#mbQ').value.trim(); dir.offset = 0; loadMembers(); });
    $('#mbNiche').addEventListener('change', e => { dir.niche = e.target.value || null; dir.offset = 0; loadMembers(); });
    $('#mbMore').addEventListener('click', () => { dir.offset += 24; loadMembers(true); });
  }

  /* ======================================================
     MEMBER PROFILE (#/u/:id, #/u/me)
     ====================================================== */
  function renderMember() { return `<div id="memberBox">${loading(320)}</div>`; }

  function connectButton(p) {
    const c = p.connection;
    if (!c) return `<button class="btn soft" data-connect="${p.id}"><i data-lucide="user-plus"></i>Connect</button>`;
    if (c.status === 'accepted') return `<button class="btn soft" data-conn-action="withdraw" data-conn="${c.id}" data-confirm="Remove this connection?"><i data-lucide="user-check"></i>Connected</button>`;
    if (c.direction === 'incoming') return `<button class="btn primary" data-conn-action="accept" data-conn="${c.id}"><i data-lucide="user-check"></i>Accept connection</button>`;
    return `<button class="btn soft" data-conn-action="withdraw" data-conn="${c.id}" data-confirm="Withdraw your connection request?"><i data-lucide="clock"></i>Request pending</button>`;
  }

  function memberHtml(p) {
    if (!p) return empty('user-x', 'This member does not exist.');
    if (!p.available) return `${head('lock', 'Profile', 'Profile not available', 'This member has not published their profile.')}<a class="btn primary" href="#/members">Discover members</a>`;
    const c = p.creator, b = p.brand;
    const links = c?.social_links || b?.social_links || {};
    const linkList = Object.entries(links).filter(([, u]) => /^https?:\/\//.test(u || ''));
    const actions = p.is_self
      ? `<div class="p-actions"><a class="btn primary" href="#/account"><i data-lucide="user-round-pen"></i>Edit profile</a>${p.published ? '' : '<span class="status-pill">Not published: only you can see this</span>'}</div>`
      : `<div class="p-actions">
          <button class="btn primary" data-collab="${p.id}" data-name="${esc(p.name)}" ${p.pending_collaboration ? 'disabled title="You already have a pending request"' : ''}><i data-lucide="handshake"></i>${p.pending_collaboration ? 'Request pending' : 'Request Collaboration'}</button>
          <button class="btn soft" data-dm="${p.id}"><i data-lucide="message-circle"></i>Send Message</button>
          ${connectButton(p)}
        </div>`;
    const section = (title, body) => (body ? `<div class="panel"><h3>${title}</h3>${body}</div>` : '');
    const tags = arr => (arr && arr.length ? `<div class="p-tags">${arr.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : '');
    return `
      <section class="member-head panel">
        ${avatar(p.avatar_url, p.name, 104)}
        <div class="member-id">
          <h1>${esc(p.name)}</h1>
          <p class="muted">${p.role === 'creator' ? 'Content creator' : 'Brand / Business'}${c?.city ? ` · ${esc(c.city)}` : ''}${b?.industry ? ` · ${esc(b.industry)}` : ''} · member since ${new Date(p.member_since).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</p>
          ${c ? `<p><small class="avail ${c.availability}">${{ open: 'Open to collaborations', limited: 'Limited availability', unavailable: 'Not available for collaborations' }[c.availability]}</small></p>` : ''}
        </div>
        ${actions}
      </section>
      <div class="member-layout">
        <div class="member-main">
          ${c ? section('About', `<p>${esc(c.bio || 'No bio yet.')}</p>`) : section('About the company', `<p>${esc(b?.description || 'No description yet.')}</p>`)}
          ${c ? section('Niches & skills', tags((c.niches || []).map(n => NICHE_LABEL[n])) + tags(c.skills)) : ''}
          ${c?.packages ? section('Services & pricing', `<p class="pre">${esc(c.packages)}</p>${c.price_from != null ? `<p class="muted">Starting from ${inr(c.price_from)}</p>` : ''}`) : ''}
          ${c?.portfolio_links?.length ? section('Portfolio & previous work', `<ul class="link-list">${c.portfolio_links.map(u => `<li><a class="text-link" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u.replace(/^https?:\/\//, ''))}</a></li>`).join('')}</ul>`) : ''}
          ${b ? section('Campaign requirements', b.campaign_requirements ? `<p class="pre">${esc(b.campaign_requirements)}</p>` : '') : ''}
          ${b ? section('Collaboration opportunities', b.collaboration_opportunities ? `<p class="pre">${esc(b.collaboration_opportunities)}</p>` : '') : ''}
          ${b?.open_campaigns?.length ? section('Open campaigns', b.open_campaigns.map(x => `<div class="mini-camp" data-campaign="${x.id}" tabindex="0"><div><b>${esc(x.title)}</b><small class="muted">${NICHE_LABEL[x.category] || ''}</small></div><i data-lucide="chevron-right"></i></div>`).join('')) : ''}
        </div>
        <aside class="member-side">
          ${c?.stats ? section('Audience (self-reported)', `<div class="stat-row">${c.stats.followers != null ? `<div><b>${compact(c.stats.followers)}</b><small>Followers</small></div>` : ''}${c.stats.engagement_rate != null ? `<div><b>${c.stats.engagement_rate}%</b><small>Engagement</small></div>` : ''}${c.stats.avg_views != null ? `<div><b>${compact(c.stats.avg_views)}</b><small>Avg. views</small></div>` : ''}</div>`) : ''}
          ${c?.languages?.length ? section('Languages', tags(c.languages)) : ''}
          ${b ? section('Details', `<dl class="kv">${b.website ? `<dt>Website</dt><dd><a class="text-link" href="${esc(b.website)}" target="_blank" rel="noopener noreferrer">${esc(b.website.replace(/^https?:\/\//, ''))}</a></dd>` : ''}${b.target_audience ? `<dt>Audience</dt><dd>${esc(b.target_audience)}</dd>` : ''}${b.platforms?.length ? `<dt>Platforms</dt><dd>${b.platforms.map(x => PLATFORM_META[x]?.name || x).join(', ')}</dd>` : ''}</dl>`) : ''}
          ${linkList.length ? section('Social links', `<ul class="link-list">${linkList.map(([k, u]) => `<li><i data-lucide="${PLATFORM_META[k]?.icon || 'link'}"></i><a class="text-link" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(PLATFORM_META[k]?.name || k)}</a></li>`).join('')}</ul>`) : ''}
        </aside>
      </div>`;
  }
  async function wireMember(param) {
    const box = $('#memberBox'); if (!box) return;
    const id = param === 'me' || !param ? myId() : param;
    try {
      const p = await B.db.memberProfile(id);
      box.innerHTML = memberHtml(p);
      if (p?.name) document.title = `${p.name} · CreatorVerse AI`;
      icons();
    } catch (err) { box.innerHTML = errBox(err); }
  }

  /* ======================================================
     COLLABORATION REQUEST MODAL
     ====================================================== */
  function openCollab(userId, name) {
    if (!Account.gate({ why: 'send collaboration requests' })) return;
    const body = openModal(`
      <div class="modal-head"><h2><i data-lucide="handshake"></i>Request collaboration</h2><button class="icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button></div>
      <p class="muted">To <b>${esc(name)}</b>. They'll get a notification and can accept, decline or reply.</p>
      <form id="mcForm" novalidate>
        <div class="field"><label class="field-label" for="mcSubject">Subject</label><input id="mcSubject" maxlength="140" placeholder="e.g. Diwali launch stream" /></div>
        <div class="row-2">
          <div class="field"><label class="field-label" for="mcPurpose">Collaboration purpose</label>
            <select id="mcPurpose">${['Sponsored content', 'Product review', 'Brand ambassador', 'Event / live stream', 'Content co-creation', 'UGC for ads', 'Other'].map(x => `<option>${x}</option>`).join('')}</select></div>
          <div class="field"><label class="field-label" for="mcBudget">Proposed budget (₹) <span class="opt">optional</span></label><input id="mcBudget" type="number" min="0" step="500" /></div>
        </div>
        <div class="field"><label class="field-label" for="mcDetails">Campaign details <span class="opt">optional</span></label><textarea id="mcDetails" rows="3" maxlength="3000" placeholder="Deliverables, timeline, platforms…"></textarea></div>
        <div class="field"><label class="field-label" for="mcMsg">Message</label><textarea id="mcMsg" rows="4" maxlength="3000" placeholder="Introduce yourself and what you have in mind."></textarea></div>
        <p class="form-msg" id="mcErr" role="alert" hidden></p>
        <div class="modal-foot"><button type="button" class="btn soft" data-close>Cancel</button><button class="btn primary" id="mcGo"><i data-lucide="send"></i>Send request</button></div>
      </form>`);
    body.onclick = e => { if (e.target.closest('[data-close]')) closeModal(); };
    $('#mcForm').addEventListener('submit', async e => {
      e.preventDefault();
      const v = id => $('#' + id).value.trim();
      if (!validateAll([
        [$('#mcSubject'), () => (v('mcSubject').length < 3 ? 'Add a subject (at least 3 characters).' : '')],
        [$('#mcBudget'), () => (v('mcBudget') && !(+v('mcBudget') >= 0) ? 'Enter a valid amount.' : '')],
        [$('#mcMsg'), () => (v('mcMsg').length < 10 ? 'Write a message of at least 10 characters.' : '')],
      ])) return;
      const btn = $('#mcGo'); setBusy(btn, true, 'Sending…');
      try {
        await B.db.sendCollaboration({ recipient_id: userId, subject: v('mcSubject'), purpose: v('mcPurpose'),
          campaign_details: v('mcDetails'), budget: v('mcBudget') ? Math.round(+v('mcBudget')) : null, message: v('mcMsg') });
        closeModal();
        toast(`Collaboration request sent to ${name}. They've been notified.`);
        if (location.hash.startsWith('#/u/')) App.route();
      } catch (err) { setBusy(btn, false); const m = $('#mcErr'); m.textContent = err.message; m.hidden = false; }
    });
  }

  /* ======================================================
     COLLABORATION REQUESTS PAGE (#/requests)
     ====================================================== */
  let reqTab = 'incoming';
  function renderRequests() {
    return `${head('handshake', 'Collaboration', 'Collaboration requests', 'Requests between members. Accepted requests open a conversation for both of you.')}
      <div class="seg" id="rqTabs">${[['incoming', 'Received'], ['outgoing', 'Sent']].map(([v, l]) => `<button type="button" data-v="${v}" class="${reqTab === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="rqList" class="req-list">${loading()}</div>`;
  }
  async function loadRequests() {
    const box = $('#rqList'); if (!box) return;
    try {
      const all = await B.db.collaborations();
      const list = all.filter(r => r.direction === reqTab);
      const pendingIn = all.filter(r => r.direction === 'incoming' && r.status === 'pending').length;
      const tab = $('#rqTabs [data-v="incoming"]'); if (tab) tab.textContent = `Received${pendingIn ? ` (${pendingIn} new)` : ''}`;
      box.innerHTML = list.length ? list.map(r => `
        <article class="panel req-card" data-req="${r.id}" data-other="${r.other_id}" data-name="${esc(r.other_name)}">
          <div class="req-top">${avatar(r.other_avatar, r.other_name, 44)}
            <div><b>${esc(r.subject)}</b><small class="muted">${r.direction === 'incoming' ? 'From' : 'To'} <a class="text-link" href="#/u/${r.other_id}">${esc(r.other_name)}</a> · ${esc(r.purpose)} · ${fmt(r.created_at)}</small></div>
            ${pill(r.status)}</div>
          ${r.budget != null ? `<p><b>Proposed budget:</b> ${inr(r.budget)}</p>` : ''}
          ${r.campaign_details ? `<p class="pre muted">${esc(r.campaign_details)}</p>` : ''}
          <p class="pre">${esc(r.message)}</p>
          ${r.response_note ? `<p class="muted"><b>Note:</b> ${esc(r.response_note)}</p>` : ''}
          <div class="head-actions">
            ${r.direction === 'incoming' && r.status === 'pending' ? '<button class="btn primary sm" data-rq="accept"><i data-lucide="check"></i>Accept</button><button class="btn soft sm" data-rq="decline" data-confirm="Decline this collaboration request?">Decline</button><button class="btn soft sm" data-rq="reply"><i data-lucide="message-circle"></i>Reply</button>' : ''}
            ${r.direction === 'outgoing' && r.status === 'pending' ? '<button class="btn soft sm" data-rq="cancel" data-confirm="Cancel this request?">Cancel request</button>' : ''}
            ${r.status === 'accepted' ? '<button class="btn primary sm" data-rq="open"><i data-lucide="message-circle"></i>Open conversation</button><button class="btn soft sm" data-rq="complete" data-confirm="Mark this collaboration as completed?">Mark completed</button>' : ''}
            ${['completed', 'declined', 'cancelled'].includes(r.status) && r.conversation_id ? '<button class="btn soft sm" data-rq="open">View conversation</button>' : ''}
          </div>
        </article>`).join('')
        : empty('inbox', reqTab === 'incoming' ? 'No collaboration requests received yet.' : 'You have not sent any requests yet.', '<a class="btn outline" href="#/members">Discover members</a>');
      icons();
    } catch (err) { box.innerHTML = errBox(err); }
  }
  function wireRequests() {
    if (!$('#rqList')) return;
    loadRequests();
    $('#rqTabs').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; reqTab = b.dataset.v; $$('#rqTabs button').forEach(x => x.classList.toggle('on', x === b)); loadRequests(); });
    $('#rqList').addEventListener('click', async e => {
      const b = e.target.closest('[data-rq]'); if (!b) return;
      const card = b.closest('[data-req]'), action = b.dataset.rq;
      if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
      if (action === 'reply' || action === 'open') return openConversationWith(card.dataset.other, b);
      setBusy(b, true, '…');
      try {
        const r = await B.db.respondCollaboration(card.dataset.req, action);
        toast({ accepted: 'Request accepted. A conversation is ready for you both.', declined: 'Request declined.', cancelled: 'Request cancelled.', completed: 'Marked as completed.' }[r.status] || 'Updated');
        if (r.status === 'accepted' && r.conversation_id) { location.hash = '#/messages/m-' + r.conversation_id; return; }
        loadRequests();
      } catch (err) { setBusy(b, false); toast(err.message, 'err'); }
    });
  }

  /* ======================================================
     MY CONNECTIONS (#/connections)
     ====================================================== */
  let connTab = 'connected';
  function renderConnections() {
    return `${head('users-round', 'Network', 'My Connections', 'People you are connected with. Connection requests are separate from collaboration requests.', '<a class="btn primary" href="#/members"><i data-lucide="user-plus"></i>Find people</a>')}
      <div class="seg" id="cnTabs">${[['connected', 'Connected'], ['incoming', 'Requests'], ['outgoing', 'Sent']].map(([v, l]) => `<button type="button" data-v="${v}" class="${connTab === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="cnList" class="member-grid">${loading()}</div>`;
  }
  async function loadConnections() {
    const box = $('#cnList'); if (!box) return;
    try {
      const all = await B.db.connections();
      const list = all.filter(c => (connTab === 'connected' ? c.status === 'accepted' : c.status === 'pending' && c.direction === connTab));
      const n = all.filter(c => c.status === 'pending' && c.direction === 'incoming').length;
      const tab = $('#cnTabs [data-v="incoming"]'); if (tab) tab.textContent = `Requests${n ? ` (${n})` : ''}`;
      box.innerHTML = list.length ? list.map(c => `
        <div class="member-card" data-conn-row="${c.id}">
          <a href="#/u/${c.other_id}">${avatar(c.other_avatar, c.other_name, 56)}</a>
          <div><a href="#/u/${c.other_id}"><b>${esc(c.other_name)}</b></a> <span class="status-pill">${c.other_role === 'creator' ? 'Creator' : 'Brand'}</span>
            <small class="muted">${c.status === 'accepted' ? `Connected ${fmt(c.responded_at)}` : `Requested ${fmt(c.created_at)}`}</small>
            <div class="head-actions">
              ${c.status === 'accepted' ? `<button class="btn primary sm" data-dm="${c.other_id}"><i data-lucide="message-circle"></i>Message</button><button class="btn soft sm" data-conn-action="withdraw" data-conn="${c.id}" data-confirm="Remove this connection?">Remove</button>` : ''}
              ${c.status === 'pending' && c.direction === 'incoming' ? `<button class="btn primary sm" data-conn-action="accept" data-conn="${c.id}">Accept</button><button class="btn soft sm" data-conn-action="decline" data-conn="${c.id}">Decline</button>` : ''}
              ${c.status === 'pending' && c.direction === 'outgoing' ? `<button class="btn soft sm" data-conn-action="withdraw" data-conn="${c.id}" data-confirm="Withdraw this request?">Withdraw</button>` : ''}
            </div></div>
        </div>`).join('')
        : empty('users-round', { connected: 'No connections yet.', incoming: 'No pending connection requests.', outgoing: 'No sent requests waiting.' }[connTab], '<a class="btn outline" href="#/members">Discover members</a>');
      icons();
    } catch (err) { box.innerHTML = errBox(err); }
  }
  function wireConnections() {
    if (!$('#cnList')) return;
    loadConnections();
    $('#cnTabs').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; connTab = b.dataset.v; $$('#cnTabs button').forEach(x => x.classList.toggle('on', x === b)); loadConnections(); });
  }

  // Shared button handlers (profile, connections, inbox) - delegated from App's global click handler
  async function handleClick(e) {
    const t = e.target;
    const connect = t.closest('[data-connect]');
    if (connect) {
      if (!Account.gate({ why: 'connect with members' })) return true;
      setBusy(connect, true, 'Sending…');
      try { const r = await B.db.requestConnection(connect.dataset.connect); toast(r.status === 'accepted' ? 'You are now connected.' : 'Connection request sent.'); refreshCurrent(); }
      catch (err) { setBusy(connect, false); toast(err.message, 'err'); }
      return true;
    }
    const ca = t.closest('[data-conn-action]');
    if (ca) {
      if (ca.dataset.confirm && !confirm(ca.dataset.confirm)) return true;
      setBusy(ca, true, '…');
      try { await B.db.respondConnection(ca.dataset.conn, ca.dataset.connAction); toast({ accept: 'Connection accepted.', decline: 'Request declined.', withdraw: 'Done.' }[ca.dataset.connAction]); refreshCurrent(); }
      catch (err) { setBusy(ca, false); toast(err.message, 'err'); }
      return true;
    }
    const dm = t.closest('[data-dm]');
    if (dm) { openConversationWith(dm.dataset.dm, dm); return true; }
    const collab = t.closest('[data-collab]');
    if (collab) { openCollab(collab.dataset.collab, collab.dataset.name); return true; }
    return false;
  }
  function refreshCurrent() {
    if (location.hash.startsWith('#/connections')) loadConnections();
    else if (location.hash.startsWith('#/u/')) wireMember(location.hash.split('/')[2]);
    else App.route();
  }
  async function openConversationWith(userId, btn) {
    if (!Account.gate({ why: 'send messages' })) return;
    if (btn) setBusy(btn, true, 'Opening…');
    try { const id = await B.db.startConversation(userId); location.hash = '#/messages/m-' + id; }
    catch (err) { if (btn) setBusy(btn, false); toast(err.message, 'err'); }
  }

  /* ======================================================
     MESSAGES: member inbox + conversation (inside the existing #/messages page)
     ====================================================== */
  let inbox = [], unsubscribe = null, pollTimer = null, openConv = null;

  async function refreshUnread() {
    if (!B.configured || !B.session || B.dbMissing) return 0;
    try { inbox = await B.db.conversations(); } catch { return 0; }
    const n = inbox.reduce((s, c) => s + (c.unread || 0), 0);
    const badge = $('#msgBadge'); if (badge) { badge.hidden = !n; badge.textContent = n; }
    return n;
  }

  function inboxListHtml(activeId) {
    return inbox.length ? inbox.map(c => `
      <a class="thread ${c.id === activeId ? 'on' : ''}" href="#/messages/m-${c.id}">
        ${avatar(c.other_avatar, c.other_name, 42)}
        <div class="th-main"><div class="th-top"><b>${esc(c.other_name)}</b><small>${c.last_at ? timeAgo(new Date(c.last_at).getTime()) : ''}</small></div>
        <p>${esc((c.last_body || 'No messages yet').slice(0, 70))}</p></div>
        ${c.unread ? `<em class="badge">${c.unread}</em>` : ''}
      </a>`).join('') : '<p class="muted sm-text" style="padding:8px 12px">No member conversations yet. Open a member profile and choose <b>Send Message</b>.</p>';
  }

  async function wireInbox(activeId) {
    const box = $('#memberInbox'); if (!box) return;
    if (!B.configured || B.dbMissing) { box.innerHTML = '<p class="muted sm-text" style="padding:8px 12px">Member messaging needs the database setup (see SETUP.md).</p>'; return; }
    await refreshUnread();
    if ($('#memberInbox')) { $('#memberInbox').innerHTML = inboxListHtml(activeId); icons(); }
  }

  const bubbleHtml = (m, other) => {
    if (m.kind === 'system') return `<div class="sys-msg"><i data-lucide="info"></i>${esc(m.body)}</div>`;
    const mine = m.sender_id === myId();
    return `<div class="bubble ${mine ? 'me' : ''}" data-mid="${m.id}">
      ${mine ? '' : `<div class="bubble-who">${avatar(other.other_avatar, other.other_name, 22)}<b>${esc(other.other_name)}</b></div>`}
      <p>${esc(m.body)}</p><small>${fmt(m.created_at)}</small></div>`;
  };

  async function wireConversation(convId) {
    const pane = $('#memberChat'); if (!pane) return;
    stopLive();
    openConv = convId;
    try {
      if (!inbox.some(c => c.id === convId)) inbox = await B.db.conversations();
      const other = inbox.find(c => c.id === convId);
      if (!other) { pane.innerHTML = empty('message-circle-x', 'Conversation not found or not available.'); return; }
      const msgs = await B.db.messages(convId);
      pane.innerHTML = `
        <header class="chat-head">
          <a class="icon-btn back" href="#/messages" aria-label="Back"><i data-lucide="arrow-left"></i></a>
          <a href="#/u/${other.other_id}">${avatar(other.other_avatar, other.other_name, 42)}</a>
          <div><a href="#/u/${other.other_id}"><b>${esc(other.other_name)}</b></a><small class="muted">${other.other_role === 'creator' ? 'Creator' : 'Brand'}${other.connected ? ' · connected' : ''}</small></div>
          <div class="chat-head-act">
            <a class="btn soft" href="#/u/${other.other_id}">Profile</a>
            ${other.connected ? '' : `<button class="btn primary" data-connect="${other.other_id}"><i data-lucide="user-plus"></i>Connect</button>`}
          </div>
        </header>
        <div class="chat-body" id="mChatBody">${msgs.length ? msgs.map(m => bubbleHtml(m, other)).join('') : '<p class="muted center">Say hello 👋</p>'}</div>
        <form class="chat-input" id="mChatForm" novalidate>
          <input id="mChatText" placeholder="Write a message…" maxlength="4000" autocomplete="off" aria-label="Message" />
          <button class="btn primary" aria-label="Send"><i data-lucide="send"></i></button>
        </form>
        <p class="form-msg" id="mChatErr" role="alert" hidden></p>`;
      icons();
      const body = $('#mChatBody'); body.scrollTop = body.scrollHeight;
      const seen = new Set(msgs.map(m => m.id));
      const append = m => {
        if (seen.has(m.id) || m.conversation_id && m.conversation_id !== convId) return;
        seen.add(m.id);
        body.querySelector('.center')?.remove();
        body.insertAdjacentHTML('beforeend', bubbleHtml(m, other)); icons();
        body.scrollTop = body.scrollHeight;
      };
      B.db.markConversationRead(convId).then(() => { refreshUnread(); App.refreshChrome(); }, () => {});
      $('#mChatForm').addEventListener('submit', async e => {
        e.preventDefault();
        const input = $('#mChatText'), text = input.value.trim(), err = $('#mChatErr');
        err.hidden = true;
        if (!text) { input.focus(); return; }
        if (text.length > 4000) { err.textContent = 'Messages can be up to 4,000 characters.'; err.hidden = false; return; }
        input.disabled = true;
        try { const m = await B.db.sendMessage(convId, text); append(m); input.value = ''; }
        catch (ex) { err.textContent = ex.message; err.hidden = false; }
        finally { input.disabled = false; input.focus(); }
      });
      // live updates: Supabase Realtime when available, plus a light poll as a fallback
      unsubscribe = B.subscribe(m => { if (m.conversation_id === convId) { append(m); B.db.markConversationRead(convId).catch(() => {}); } });
      pollTimer = setInterval(async () => {
        if (!$('#mChatBody') || openConv !== convId) return stopLive();
        try { (await B.db.messages(convId, 30)).forEach(append); } catch { /* transient */ }
      }, 10000);
      $('#mChatText').focus();
    } catch (err) { pane.innerHTML = errBox(err); }
  }
  function stopLive() { unsubscribe?.(); unsubscribe = null; clearInterval(pollTimer); pollTimer = null; openConv = null; }

  // Global live notifications (header badge + toast) while signed in
  let globalSub = null;
  function startGlobalLive() {
    if (globalSub || !B.session || B.dbMissing) return;
    globalSub = B.subscribe(m => {
      if (m.sender_id !== myId() && openConv !== m.conversation_id) refreshUnread();
    }, n => { if (n.kind !== 'new_message' || !location.hash.includes(n.link?.split('/').pop())) toast(n.title); App.refreshChrome(); });
  }
  function stopGlobalLive() { globalSub?.(); globalSub = null; }

  /* ---------- Dashboard network panel ---------- */
  async function networkSummary() {
    const [collabs, conns] = await Promise.all([B.db.collaborations(), B.db.connections()]);
    await refreshUnread();
    return {
      collabIn: collabs.filter(r => r.direction === 'incoming' && r.status === 'pending').length,
      collabActive: collabs.filter(r => r.status === 'accepted').length,
      connIn: conns.filter(c => c.status === 'pending' && c.direction === 'incoming').length,
      connected: conns.filter(c => c.status === 'accepted').length,
      unread: inbox.reduce((s, c) => s + (c.unread || 0), 0),
    };
  }

  const views = {
    members: [renderMembers, wireMembers], u: [renderMember, wireMember],
    requests: [renderRequests, wireRequests], connections: [renderConnections, wireConnections],
  };
  return { views, handleClick, wireInbox, wireConversation, stopLive, refreshUnread, startGlobalLive, stopGlobalLive, networkSummary, openCollab };
})();
