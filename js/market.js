/* ================= CreatorVerse AI: creator marketplace ================= */
const App = (() => {
  const { CREATORS, CAMPAIGNS, CATEGORIES, catById, PLATFORM_META, FEATURED, LANGUAGES, BUDGETS, NICHE_LABEL, U } = DATA;
  const B = Backend;
  const byId = Object.fromEntries(CREATORS.map(c => [c.id, c]));
  const budgetById = Object.fromEntries(BUDGETS.map(b => [b.id, b]));
  const DAY = 86400000;

  /* ---------- State ----------
     Account data (saved creators, campaigns, applications, requests, notifications) lives in Supabase.
     Only the AI-simulated demo chat is kept in this browser. */
  const S = {
    saved: new Set(),
    notifs: [],
    threads: store.get('threads', null) || seedThreads(),
    explore: freshExplore(),
    campFilter: 'all',
    campStatus: 'all',
    campQ: '',
    dbCampaigns: [],
    myCampaigns: [],
    myApplications: [],
    requests: [],
    match: null,
    matchResults: null,
    next: null,
    viewed: new Set(readViewed()),  // profiles already counted this session (not double-charged on re-render)
  };
  function readViewed() { try { return JSON.parse(sessionStorage.getItem('cverse:viewed') || '[]'); } catch { return []; } }
  const role = () => B.profile?.role || null;
  const uidNow = () => B.user?.id || null;

  function freshExplore() {
    return { q: '', cat: 'all', platforms: new Set(), langs: new Set(), budget: 'any', tier: 'all', minRating: 0, sort: 'recommended' };
  }

  function seedThreads() {
    const brandThreads = DATA.SEED_THREADS.map(t => ({ id: 'b-' + t.creatorId, role: 'brand', partnerId: t.creatorId, messages: t.messages, unread: false }));
    const creatorThreads = [
      { id: 'c-Kora Skincare', role: 'creator', partnerId: 'Kora Skincare', unread: false, messages: [
        { from: 'them', text: 'Hi! We loved your recent reels. We have a skincare launch next month, would you be interested in a Reel + Stories package?', t: Date.now() - 6 * 3600000 },
      ] },
    ];
    return [...brandThreads, ...creatorThreads];
  }

  function persist() {
    store.set('threads', S.threads);
    try { sessionStorage.setItem('cverse:viewed', JSON.stringify([...S.viewed])); } catch { /* blocked */ }
  }

  const initialsOf = name => (name || '?').split(/[\s@.]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const me = () => {
    const name = B.profile?.full_name || B.user?.email?.split('@')[0] || 'Guest';
    return { name, avatar: B.profile?.avatar_url || null, initials: initialsOf(name) };
  };

  // Campaigns from the database are normalised to the shape the sample campaigns use
  const STATUS_LABEL = { draft: 'Draft', open: 'Open', in_review: 'In review', closed: 'Closed' };
  const fmtShort = d => new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  const fromDb = c => ({
    id: c.id, db: true, owner_id: c.owner_id, brand: c.brand_name || 'Brand', color: 'linear-gradient(135deg,#7137F0,#D82DE5)',
    title: c.title, category: c.category, budget: [c.budget_min, c.budget_max], platforms: c.platforms, deadline: fmtShort(c.deadline),
    rawDeadline: c.deadline, status: STATUS_LABEL[c.status], rawStatus: c.status, cover: U(catById[c.category].img, 900),
    brief: c.brief, deliverables: c.deliverables, applications: c.applications || null,
  });
  const SAMPLE_CAMPAIGNS = CAMPAIGNS.map(c => ({ ...c, sample: true }));
  const allCampaigns = () => {
    const mine = S.myCampaigns.map(fromDb);
    const others = S.dbCampaigns.filter(c => !S.myCampaigns.some(m => m.id === c.id)).map(fromDb);
    return [...mine, ...others, ...SAMPLE_CAMPAIGNS];
  };
  const campaignById = id => allCampaigns().find(c => c.id === id);
  const brandByName = name => allCampaigns().find(c => c.brand === name);

  // Loads the signed-in user's saved creators and recent notifications for the header
  async function loadUserData() {
    if (!B.session) { S.saved = new Set(); S.notifs = []; return; }
    try {
      const [saved, notifs] = await Promise.all([B.db.savedIds(), B.db.notifications(8)]);
      S.saved = new Set(saved);
      S.notifs = notifs;
    } catch (err) { console.warn('Could not load account data', err); }
  }

  /* ---------- Small templates ---------- */
  const stars = r => `<span class="stars" style="--r:${(r / 5) * 100}%" aria-label="${r} out of 5"></span>`;
  const platIcon = p => `<span class="plat-ico ${p}" title="${PLATFORM_META[p].name}"><i data-lucide="${PLATFORM_META[p].icon}"></i></span>`;
  const platIcons = c => Object.keys(c.platforms).map(p => `<i data-lucide="${PLATFORM_META[p].icon}" title="${PLATFORM_META[p].name}" style="color:${PLATFORM_META[p].color}"></i>`).join('');
  const badgeFor = c => c.badges.includes('top') ? '<span class="c-badge top"><i data-lucide="crown"></i>Top rated</span>'
    : c.badges.includes('rising') ? '<span class="c-badge rising"><i data-lucide="trending-up"></i>Rising</span>' : '';
  const brandLogo = (name, color, size = 40) => `<span class="brand-logo" style="background:${color};width:${size}px;height:${size}px">${esc(name.split(' ').map(w => w[0]).join('').slice(0, 2))}</span>`;
  const meAvatar = (size = 34) => {
    const m = me();
    return m.avatar
      ? `<img class="av" src="${m.avatar}" alt="" style="width:${size}px;height:${size}px">`
      : `<span class="av initials" style="width:${size}px;height:${size}px">${esc(m.initials)}</span>`;
  };
  const sampleNote = (text = 'Sample data for demonstration') => `<span class="sample-note"><i data-lucide="info"></i>${text}</span>`;

  function creatorCard(c, i = 0) {
    return `
    <article class="c-card" data-open-creator="${c.id}" tabindex="0" aria-label="${esc(c.name)}, ${catById[c.category].name} creator" style="animation-delay:${Math.min(i, 12) * 40}ms">
      <div class="c-cover">
        <img src="${c.thumb}" alt="${esc(c.name)} content" loading="lazy" />
        ${badgeFor(c)}
        <button class="heart ${S.saved.has(c.id) ? 'on' : ''}" data-save="${c.id}" aria-label="Save creator"><i data-lucide="heart"></i></button>
      </div>
      <div class="c-body">
        <img class="c-avatar" src="${c.avatar}" alt="" loading="lazy" />
        <div class="c-name">${esc(c.name)}</div>
        <div class="c-sub">@${esc(c.handle)} · ${esc(c.city)}</div>
        <div class="c-cat"><i data-lucide="${catById[c.category].icon}"></i>${catById[c.category].name}</div>
        <div class="c-stats">
          <span><b>${compact(c.followers)}</b>followers</span>
          <span><b>${c.engagement}%</b>engagement</span>
          <span><b><i data-lucide="star" class="star-ico"></i>${c.rating}</b>${c.reviews} reviews</span>
        </div>
        <div class="c-foot">
          <div class="c-plats">${platIcons(c)}</div>
          <div class="c-price">From <b>${inr(c.priceFrom)}</b></div>
        </div>
      </div>
    </article>`;
  }

  const statusTone = s => s === 'Open' || !s ? 'open' : s === 'Closed' ? 'closed' : 'review';

  function campaignCard(c, i = 0) {
    const app = S.myApplications.find(a => a.campaign_id === c.id);
    const mine = c.db && c.owner_id === uidNow();
    const flag = mine ? '<span class="camp-flag">Your campaign</span>'
      : app ? `<span class="camp-flag ok"><i data-lucide="check"></i>Applied · ${esc(app.status)}</span>`
      : c.sample ? '<span class="camp-flag sample">Sample brief</span>' : '';
    const foot = c.sample ? `<span class="applicants"><i data-lucide="users"></i>${c.applicants} applied (sample)</span>`
      : mine ? `<span class="applicants"><i data-lucide="users"></i>${c.applications?.length || 0} application${c.applications?.length === 1 ? '' : 's'}</span>`
      : '<span class="applicants"><i data-lucide="badge-check"></i>Member brand</span>';
    return `
    <article class="camp-card" data-campaign="${c.id}" tabindex="0" style="animation-delay:${i * 50}ms">
      <div class="camp-cover"><img src="${c.cover}" alt="" loading="lazy" />
        <span class="camp-cat"><i data-lucide="${catById[c.category].icon}"></i>${catById[c.category].name}</span>
        ${flag}
        <span class="camp-status ${statusTone(c.status)}">${esc(c.status || 'Open')}</span>
      </div>
      <div class="camp-body">
        <div class="camp-brand">${brandLogo(c.brand, c.color, 32)}<span>${esc(c.brand)}</span></div>
        <h3>${esc(c.title)}</h3>
        <div class="camp-meta">
          <span><i data-lucide="wallet"></i>${inr(c.budget[0])} – ${inr(c.budget[1])}</span>
          <span><i data-lucide="calendar"></i>${esc(c.deadline)}</span>
        </div>
        <div class="camp-foot">
          <div class="c-plats">${c.platforms.map(p => `<i data-lucide="${PLATFORM_META[p].icon}" style="color:${PLATFORM_META[p].color}"></i>`).join('')}</div>
          ${foot}
        </div>
      </div>
    </article>`;
  }

  /* ======================================================
     HOME (landing page)
     ====================================================== */
  const TIKTOK_SVG = '<svg viewBox="0 0 24 24" class="lucide" aria-hidden="true"><path fill="currentColor" stroke="none" d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-1.8-2.5V9.7a5.7 5.7 0 1 0 4.9 5.7V9.1a7.3 7.3 0 0 0 4.3 1.4V7.4a4.3 4.3 0 0 1-3.2-1.6z"/></svg>';

  function featureCard(c, feat) {
    const badge = feat ? { label: feat.label, icon: feat.icon, tone: feat.tone }
      : c.badges.includes('top') ? { label: 'Top Rated', icon: 'crown', tone: 'orange' }
      : c.badges.includes('rising') ? { label: 'Rising Star', icon: 'trending-up', tone: 'teal' } : null;
    return `
      <article class="fcard" role="listitem">
        <a class="fcard-media" href="#/creator/${c.id}" tabindex="-1" aria-hidden="true">
          <img src="${feat ? feat.img : c.thumb}" alt="" loading="lazy" />
          ${badge ? `<span class="fbadge ${badge.tone}"><i data-lucide="${badge.icon}"></i>${esc(badge.label)}</span>` : ''}
        </a>
        <div class="fcard-body">
          <h3><a href="#/creator/${c.id}">${esc(c.name)}</a></h3>
          <p class="fniche">${NICHE_LABEL[c.category]}</p>
          <div class="fplats">${Object.keys(c.platforms).map(platIcon).join('')}</div>
          <div class="fmetrics">
            <div><i data-lucide="users"></i><span><b>${compact(c.followers)}</b><small>Followers</small></span></div>
            <div><span><b>${c.engagement}%</b><small>Engagement</small></span></div>
          </div>
          <a class="btn outline block sm" href="#/creator/${c.id}" aria-label="View ${esc(c.name)}'s profile">View Profile</a>
        </div>
      </article>`;
  }

  function renderHome() {
    const featured = FEATURED.map(f => featureCard(byId[f.id], f));
    const more = CREATORS.filter(c => !FEATURED.some(f => f.id === c.id)).slice(0, 6).map(c => featureCard(c));
    const strip = ['collage-1', 'collage-2', 'collage-3', 'collage-4'];
    return `
    <section class="hero">
      <div class="hero-bg" aria-hidden="true"><span class="hb1"></span><span class="hb2"></span><span class="hb3"></span></div>
      <div class="container hero-grid">
        <div class="hero-copy">
          <span class="pill-badge"><i data-lucide="sparkles"></i>AI-Powered Creator Marketplace</span>
          <h1>Find Your <span class="grad">Perfect Creator.</span><br>Build Your Next Big Campaign.</h1>
          <p class="hero-lead">CreatorVerse AI helps brands find the right creators using AI-powered matching. Save time, get better results, and grow your brand with authentic creators.</p>
          <form class="hero-search" id="heroSearch" role="search">
            <label class="hs-field hs-q"><i data-lucide="search"></i><input name="q" placeholder="What kind of creator are you looking for?" aria-label="What kind of creator are you looking for?" autocomplete="off" /></label>
            <label class="hs-field hs-sel"><i data-lucide="monitor-smartphone"></i>
              <select name="platform" aria-label="Platform"><option value="all">All Platforms</option>${Object.entries(PLATFORM_META).map(([id, p]) => `<option value="${id}">${p.name}</option>`).join('')}</select></label>
            <label class="hs-field hs-sel"><i data-lucide="tag"></i>
              <select name="cat" aria-label="Niche"><option value="all">All Niches</option>${CATEGORIES.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></label>
            <label class="hs-field hs-sel"><i data-lucide="circle-dollar-sign"></i>
              <select name="budget" aria-label="Budget">${BUDGETS.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}</select></label>
            <button class="btn primary">Find Creators<i data-lucide="arrow-right"></i></button>
          </form>
          <ul class="trust-row">
            <li><i data-lucide="check-circle-2"></i>AI-Powered Matching</li>
            <li><i data-lucide="receipt-text"></i>Transparent Packages</li>
            <li><i data-lucide="shield-check"></i>Secure Payments</li>
            <li><i data-lucide="languages"></i>Multilingual Creators</li>
          </ul>
        </div>

        <div class="hero-art">
          <div class="ha-shape" aria-hidden="true"><span></span><span></span><span></span></div>
          <svg class="ha-swirl" viewBox="0 0 80 60" aria-hidden="true"><path d="M70 8c-30-6-60 8-50 28 6 12 26 10 24-2-2-10-20-6-26 6" fill="none" stroke="#FF9948" stroke-width="1.6" stroke-linecap="round"/></svg>
          <span class="ha-stroke" aria-hidden="true"></span>
          <img class="ha-main" src="assets/img/hero-main.jpg" alt="Smiling lifestyle creator wearing sunglasses and a lavender sweater" />
          <a class="ha-card ha-match" href="#/match">
            <span class="ha-spark"><i data-lucide="sparkles"></i></span>
            <span><b>Perfect Match!</b><small>AI found 12 creators for your campaign</small></span>
          </a>
          <a class="ha-card ha-profile" href="#/creator/aanya">
            <img src="assets/img/collage-3.jpg" alt="" />
            <span><b>Lifestyle Creator</b><small>Creator profile preview</small><small class="ha-bars"><i></i><i></i><i></i></small></span>
          </a>
          <span class="ha-social yt" aria-hidden="true"><i data-lucide="youtube"></i></span>
          <span class="ha-social tt" aria-hidden="true">${TIKTOK_SVG}</span>
          <span class="ha-social ig" aria-hidden="true"><i data-lucide="instagram"></i></span>
          <div class="ha-strip">
            ${strip.map((s, i) => `<a href="#/explore" class="ha-thumb t${i}" aria-label="Browse creators"><img src="assets/img/${s}.jpg" alt="" loading="lazy" /></a>`).join('')}
            <a class="ha-next" href="#/explore" aria-label="Browse all creators"><i data-lucide="chevron-right"></i></a>
          </div>
          <p class="ha-script" aria-hidden="true">Real People<br>Real Impact <span>♡</span></p>
        </div>
      </div>
    </section>

    <section class="featured" aria-labelledby="featuredTitle">
      <div class="container">
        <div class="sec-head">
          <div>
            <span class="pill-badge"><i data-lucide="star"></i>Featured Creators</span>
            <h2 id="featuredTitle">Top Creators for Your Next Campaign</h2>
            <p>Discover talented creators across various niches and platforms. Find the perfect match for your brand.</p>
          </div>
          <a class="view-all" href="#/explore">View All Creators<i data-lucide="arrow-right"></i></a>
        </div>
        <div class="fc-wrap">
          <button class="fc-arrow prev" id="fcPrev" aria-label="Previous creators" hidden><i data-lucide="chevron-left"></i></button>
          <div class="fc-row" id="fcRow" role="list">${featured.join('')}${more.join('')}</div>
          <button class="fc-arrow next" id="fcNext" aria-label="Next creators"><i data-lucide="chevron-right"></i></button>
        </div>
        <p class="sample-line">${sampleNote('Creators, follower counts and engagement rates are sample data. Portraits are AI-generated.')}</p>
      </div>
    </section>

    <section class="how" aria-labelledby="howTitle">
      <div class="container how-grid">
        <div class="how-copy">
          <span class="pill-badge"><i data-lucide="rocket"></i>How It Works</span>
          <h2 id="howTitle">Get Started in 3 Simple Steps</h2>
          <p>From discovery to collaboration, we make it easy for brands and creators to work together and create amazing content.</p>
        </div>
        <div class="how-steps">
          <a class="hstep" href="#/explore"><span class="hs-ico violet"><i data-lucide="search"></i></span><h3>1. Discover</h3><p>Browse talented creators or use our AI-powered search.</p></a>
          <span class="hs-arrow" aria-hidden="true"><i data-lucide="arrow-right"></i></span>
          <a class="hstep" href="#/match"><span class="hs-ico pink"><i data-lucide="brain"></i></span><h3>2. Match with AI</h3><p>Our matching engine suggests suitable creators for your brand and campaign.</p></a>
          <span class="hs-arrow" aria-hidden="true"><i data-lucide="arrow-right"></i></span>
          <a class="hstep" href="#/campaigns"><span class="hs-ico teal"><i data-lucide="handshake"></i></span><h3>3. Collaborate</h3><p>Send requests, manage campaigns, and track progress in one place.</p></a>
        </div>
      </div>
    </section>

    <section class="cta-strip" aria-labelledby="ctaTitle">
      <div class="cta-shapes" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <div class="container cta-inner">
        <div class="cta-person"><img src="assets/img/cta-creator.jpg" alt="Creator holding a camera" loading="lazy" /></div>
        <span class="cta-rocket" aria-hidden="true"><i data-lucide="rocket"></i></span>
        <div class="cta-copy">
          <h2 id="ctaTitle">Ready to Find Your Perfect Creator?</h2>
          <p>Join creators and brands building meaningful collaborations together.</p>
        </div>
        <a class="btn navy" href="#/explore">Explore Creators<i data-lucide="arrow-right"></i></a>
        <p class="cta-script" aria-hidden="true">Better<br>Together <span>♡</span></p>
      </div>
    </section>`;
  }

  function wireHome() {
    $('#heroSearch').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (!(await meterSearch())) return;
      const f = freshExplore();
      f.q = (fd.get('q') || '').trim();
      f.cat = fd.get('cat');
      f.budget = fd.get('budget');
      if (fd.get('platform') !== 'all') f.platforms.add(fd.get('platform'));
      S.explore = f;
      location.hash = '#/explore';
    });
    // Featured carousel: arrows scroll by one card; prev appears once scrolled
    const row = $('#fcRow'), prev = $('#fcPrev'), next = $('#fcNext');
    const step = () => (row.firstElementChild?.offsetWidth || 200) + 16;
    const sync = () => {
      prev.hidden = row.scrollLeft < 8;
      next.hidden = row.scrollLeft + row.clientWidth >= row.scrollWidth - 8;
    };
    prev.addEventListener('click', () => row.scrollBy({ left: -step() * 2, behavior: 'smooth' }));
    next.addEventListener('click', () => row.scrollBy({ left: step() * 2, behavior: 'smooth' }));
    row.addEventListener('scroll', sync, { passive: true });
    sync();
  }

  /* ======================================================
     EXPLORE (marketplace)
     ====================================================== */
  // Advanced filters (audience size, rating) are a Premium feature when the admin setting is on
  const advLocked = () => B.configured && B.settings.advanced_filters_premium_only !== false && B.tier !== 'premium';
  const lockTag = () => (advLocked() ? '<button type="button" class="lock-tag" data-premium-lock><i data-lucide="crown"></i>Premium</button>' : '');

  function renderExplore() {
    const f = S.explore;
    const langs = LANGUAGES.filter(l => CREATORS.some(c => c.languages.includes(l)));
    return `
    <section class="page-head">
      <div>
        <span class="pill-badge"><i data-lucide="compass"></i>Creator Marketplace</span>
        <h1>Explore Creators</h1>
        <p class="muted">Search and filter creators by niche, language, platform and budget. ${sampleNote('All profiles are sample data')}</p>
      </div>
      <a class="btn primary" href="#/match"><i data-lucide="sparkles"></i>AI Matching</a>
    </section>

    <div class="explore-bar">
      <form class="search-sm" id="exSearch" role="search"><i data-lucide="search"></i><input id="exQ" value="${esc(f.q)}" placeholder="Search name, niche, city or tag… (press Enter)" aria-label="Search creators" /><button class="btn primary sm" id="exGo">Search</button></form>
      <select id="exSort" aria-label="Sort">
        ${[['recommended', 'Recommended'], ['rating', 'Top rated'], ['followers', 'Most followers'], ['engagement', 'Highest engagement'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low']]
          .map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <button class="btn soft filter-toggle" id="filterToggle" aria-controls="filters"><i data-lucide="sliders-horizontal"></i>Filters</button>
    </div>

    <div class="cat-chips" id="exCats" aria-label="Niches">
      <button class="${f.cat === 'all' ? 'on' : ''}" data-cat-filter="all"><i data-lucide="layout-grid"></i>All Niches</button>
      ${CATEGORIES.map(c => `<button class="${f.cat === c.id ? 'on' : ''}" data-cat-filter="${c.id}"><i data-lucide="${c.icon}"></i>${c.name}</button>`).join('')}
    </div>

    <div class="explore-layout">
      <aside class="filters panel" id="filters" aria-label="Filters">
        <h3>Platform</h3>
        <div class="check-list">
          ${Object.entries(PLATFORM_META).map(([id, p]) => `<label class="check"><input type="checkbox" data-plat="${id}" ${f.platforms.has(id) ? 'checked' : ''}><span></span><i data-lucide="${p.icon}" style="color:${p.color}"></i>${p.name}</label>`).join('')}
        </div>
        <h3>Language</h3>
        <div class="check-list two">
          ${langs.map(l => `<label class="check"><input type="checkbox" data-lang="${l}" ${f.langs.has(l) ? 'checked' : ''}><span></span>${l}</label>`).join('')}
        </div>
        <h3>Budget <small>starting price</small></h3>
        <div class="tier-list">
          ${BUDGETS.map(b => `<button class="${f.budget === b.id ? 'on' : ''}" data-budget="${b.id}">${b.name}</button>`).join('')}
        </div>
        <h3>Audience size ${lockTag()}</h3>
        <div class="tier-list${advLocked() ? ' locked' : ''}">
          ${[['all', 'Any'], ['nano', 'Nano · < 50K'], ['micro', 'Micro · 50K–200K'], ['macro', 'Macro · 200K–1M'], ['mega', 'Mega · 1M+']]
            .map(([v, l]) => `<button class="${f.tier === v ? 'on' : ''}" data-tier="${v}">${l}</button>`).join('')}
        </div>
        <h3>Minimum rating ${lockTag()}</h3>
        <div class="tier-list row${advLocked() ? ' locked' : ''}">
          ${[0, 4.5, 4.8, 4.9].map(r => `<button class="${f.minRating === r ? 'on' : ''}" data-minr="${r}">${r ? r + '+' : 'Any'}</button>`).join('')}
        </div>
        <button class="btn soft block" data-clear-filters style="margin-top:18px"><i data-lucide="rotate-ccw"></i>Clear filters</button>
      </aside>
      <div>
        <div class="result-bar"><p class="result-count" id="resultCount" aria-live="polite"></p><button class="link" data-clear-filters>Clear filters</button></div>
        <div class="c-grid" id="exResults"></div>
      </div>
    </div>`;
  }

  function filteredCreators() {
    const f = S.explore;
    const q = f.q.trim().toLowerCase();
    const b = budgetById[f.budget] || BUDGETS[0];
    const tierOk = n => f.tier === 'all' || (f.tier === 'nano' && n < 50e3) || (f.tier === 'micro' && n >= 50e3 && n < 200e3)
      || (f.tier === 'macro' && n >= 200e3 && n < 1e6) || (f.tier === 'mega' && n >= 1e6);
    const list = CREATORS.filter(c =>
      (f.cat === 'all' || c.category === f.cat)
      && (!q || [c.name, c.handle, c.city, c.bio, catById[c.category].name, NICHE_LABEL[c.category], ...c.tags, ...c.languages].join(' ').toLowerCase().includes(q))
      && (!f.platforms.size || [...f.platforms].some(p => c.platforms[p]))
      && (!f.langs.size || [...f.langs].some(l => c.languages.includes(l)))
      && tierOk(c.followers)
      && c.priceFrom >= b.min && c.priceFrom <= b.max
      && c.rating >= f.minRating);
    const sorters = {
      recommended: (a, b) => (b.rating * b.engagement * Math.log(b.followers)) - (a.rating * a.engagement * Math.log(a.followers)),
      rating: (a, b) => b.rating - a.rating || b.reviews - a.reviews,
      followers: (a, b) => b.followers - a.followers,
      engagement: (a, b) => b.engagement - a.engagement,
      'price-asc': (a, b) => a.priceFrom - b.priceFrom,
      'price-desc': (a, b) => b.priceFrom - a.priceFrom,
    };
    return list.sort(sorters[f.sort]);
  }

  function renderResults() {
    const list = filteredCreators();
    $('#resultCount').innerHTML = `<b>${list.length}</b> creator${list.length === 1 ? '' : 's'} found`;
    $('#exResults').innerHTML = list.length ? list.map(creatorCard).join('') : `
      <div class="empty-big">
        <div class="empty-art"><i data-lucide="search-x"></i></div>
        <h3>No creators match these filters</h3>
        <p class="muted">Try another budget, language or platform, or describe your campaign to AI Matching.</p>
        <div class="head-actions"><button class="btn soft" data-clear-filters><i data-lucide="rotate-ccw"></i>Clear filters</button><a class="btn primary" href="#/match"><i data-lucide="sparkles"></i>Try AI Matching</a></div>
      </div>`;
    icons();
  }

  function wireExplore() {
    const f = S.explore;
    $('#exSearch').addEventListener('submit', async e => {
      e.preventDefault();
      const q = $('#exQ').value.trim();
      if (q === f.q) return renderResults();
      if (q && !(await meterSearch())) return;
      f.q = q;
      renderResults();
    });
    $('#exQ').addEventListener('input', e => { if (!e.target.value.trim() && f.q) { f.q = ''; renderResults(); } });
    $('#exSort').addEventListener('change', e => { f.sort = e.target.value; renderResults(); });
    $('#filterToggle').addEventListener('click', () => $('#filters').classList.toggle('open'));
    $('#filters').addEventListener('change', e => {
      const { plat, lang } = e.target.dataset;
      const set = plat ? f.platforms : lang ? f.langs : null;
      if (!set) return;
      e.target.checked ? set.add(plat || lang) : set.delete(plat || lang);
      renderResults();
    });
    $('#filters').addEventListener('click', e => {
      const t = e.target.closest('[data-tier]'), r = e.target.closest('[data-minr]'), b = e.target.closest('[data-budget]');
      if ((t || r) && advLocked()) { if (Account.gate({ why: 'use advanced filters' })) Account.upgradeDialog(null); return; }
      if (t) { f.tier = t.dataset.tier; $$('[data-tier]').forEach(x => x.classList.toggle('on', x === t)); renderResults(); }
      if (r) { f.minRating = +r.dataset.minr; $$('[data-minr]').forEach(x => x.classList.toggle('on', x === r)); renderResults(); }
      if (b) { f.budget = b.dataset.budget; $$('[data-budget]').forEach(x => x.classList.toggle('on', x === b)); renderResults(); }
    });
    $('#exCats').addEventListener('click', e => {
      const b = e.target.closest('[data-cat-filter]'); if (!b) return;
      f.cat = b.dataset.catFilter;
      $$('#exCats button').forEach(x => x.classList.toggle('on', x === b));
      renderResults();
    });
    renderResults();
  }

  /* ======================================================
     CREATOR PROFILE
     ====================================================== */
  function hashNum(s, mod) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % mod; }

  function renderProfile(id) {
    const c = byId[id];
    if (!c) return notFound();
    const cat = catById[c.category];
    const h = hashNum(c.id, 100);
    const ages = [['13–17', 6 + h % 6], ['18–24', 34 + h % 14], ['25–34', 30 + (h >> 2) % 12], ['35–44', 10 + h % 7], ['45+', 4 + h % 4]];
    const ageMax = Math.max(...ages.map(a => a[1]));
    const female = c.category === 'beauty' || c.category === 'fashion' ? 68 + h % 15 : c.category === 'gaming' || c.category === 'tech' ? 22 + h % 15 : 45 + h % 15;
    const cities = [c.city, ...['Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Pune', 'Chennai'].filter(x => x !== c.city)].slice(0, 4);
    const similar = CREATORS.filter(x => x.category === c.category && x.id !== c.id).concat(CREATORS.filter(x => x.category !== c.category && x.id !== c.id)).slice(0, 4);
    const ratingBars = [[5, 82 + h % 12], [4, 10 + h % 8], [3, 3], [2, 1], [1, 1]];

    return `
    <section class="profile">
      <div class="p-cover"><img src="${c.cover}" alt="" /></div>
      <div class="p-head">
        <img class="p-avatar" src="${c.avatar}" alt="${esc(c.name)}" />
        <div class="p-id">
          <h1>${esc(c.name)}</h1>
          <p class="muted">@${esc(c.handle)} · <i data-lucide="map-pin"></i>${esc(c.city)}, India · <i data-lucide="languages"></i>${c.languages.join(', ')}</p>
          <div class="p-tags"><span class="c-cat"><i data-lucide="${cat.icon}"></i>${NICHE_LABEL[c.category]}</span>${badgeFor(c)}${c.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        </div>
        <div class="p-actions">
          <button class="btn primary" data-request="${c.id}"><i data-lucide="send"></i>Request collaboration</button>
          <button class="btn soft" data-message="${c.id}"><i data-lucide="message-circle"></i>Message</button>
          <button class="btn soft heart-btn ${S.saved.has(c.id) ? 'on' : ''}" data-save="${c.id}"><i data-lucide="heart"></i><span>${S.saved.has(c.id) ? 'Saved' : 'Save'}</span></button>
          <button class="icon-btn" data-share="${c.id}" title="Copy profile link"><i data-lucide="share-2"></i></button>
        </div>
      </div>

      <div class="p-stats">
        ${Object.entries(c.platforms).map(([p, n]) => `<div class="ps"><i data-lucide="${PLATFORM_META[p].icon}" style="color:${PLATFORM_META[p].color}"></i><b>${compact(n)}</b><span>${PLATFORM_META[p].name}</span></div>`).join('')}
        <div class="ps"><i data-lucide="activity"></i><b>${c.engagement}%</b><span>Engagement</span></div>
        <div class="ps"><i data-lucide="star"></i><b>${c.rating}</b><span>${c.reviews} reviews</span></div>
        <div class="ps"><i data-lucide="check-check"></i><b>${c.completed}</b><span>Collabs done</span></div>
        <div class="ps"><i data-lucide="zap"></i><b>~${c.responseHrs}h</b><span>Response time</span></div>
      </div>
      <p class="sample-line">${sampleNote('Sample profile: metrics, audience and reviews are illustrative, not verified data.')}</p>

      <div class="p-layout">
        <div class="p-main">
          <nav class="p-tabs" id="pTabs">
            <button class="on" data-ptab="portfolio">Portfolio</button>
            <button data-ptab="about">About & audience</button>
            <button data-ptab="services">Services & terms</button>
            <button data-ptab="reviews">Sample reviews</button>
          </nav>

          <div class="p-pane" id="pane-portfolio">
            <div class="portfolio">
              ${c.portfolio.map((p, i) => `
                <figure class="pf-item ${i === 0 ? 'big' : ''}" data-zoom="${p.img}" data-cap="${esc(c.name)} · ${p.type}">
                  <img src="${p.img}" alt="" loading="lazy" />
                  <figcaption><span class="pf-type"><i data-lucide="${p.type === 'Reel' ? 'clapperboard' : p.type === 'Video' ? 'play-circle' : 'image'}"></i>${p.type}</span><span><i data-lucide="eye"></i>${compact(p.views)}</span></figcaption>
                </figure>`).join('')}
            </div>
          </div>

          <div class="p-pane" id="pane-about" hidden>
            <div class="panel about-grid">
              <div><h3>Biography</h3><p>${esc(c.bio)}</p></div>
              <div><h3>Languages</h3><div class="p-tags">${c.languages.map(l => `<span class="tag">${esc(l)}</span>`).join('')}</div>
                <h3 style="margin-top:14px">Platforms</h3><div class="p-tags">${Object.keys(c.platforms).map(p => `<span class="tag"><i data-lucide="${PLATFORM_META[p].icon}" style="color:${PLATFORM_META[p].color}"></i>${PLATFORM_META[p].name}</span>`).join('')}</div></div>
            </div>
            <div class="aud-grid">
              <div class="panel"><h3>Audience age</h3>
                ${ages.map(([l, v]) => `<div class="hbar"><span>${l}</span><div><i style="width:${(v / ageMax) * 100}%"></i></div><b>${v}%</b></div>`).join('')}
              </div>
              <div class="panel"><h3>Gender split</h3>
                <div class="donut" style="--p:${female}"><div><b>${female}%</b><small>Women</small></div></div>
                <div class="legend"><span><i class="lg-a"></i>Women ${female}%</span><span><i class="lg-b"></i>Men ${100 - female}%</span></div>
              </div>
              <div class="panel"><h3>Top cities</h3>
                ${cities.map((ct, i) => `<div class="hbar"><span>${ct}</span><div><i style="width:${[100, 62, 45, 30][i]}%"></i></div><b>${[38, 24, 17, 11][i]}%</b></div>`).join('')}
              </div>
            </div>
          </div>

          <div class="p-pane" id="pane-services" hidden>
            <div class="table-wrap panel">
              <table class="svc-table">
                <thead><tr><th>Package</th><th>Deliverables</th><th>Price</th><th>Turnaround</th><th>Revisions</th><th>Usage rights</th></tr></thead>
                <tbody>${c.packages.map((p, i) => `<tr>
                  <td><b>${p.tier}</b><small>${esc(p.title)}</small></td>
                  <td><ul>${p.items.filter(x => !/revision|usage rights/i.test(x)).map(x => `<li>${esc(x)}</li>`).join('')}</ul></td>
                  <td><b>${inr(p.price)}</b></td><td>${p.days} days</td><td>${esc(p.revisions)}</td><td>${esc(p.rights)}</td>
                </tr>`).join('')}</tbody>
              </table>
            </div>
            <p class="muted sm-text">Prices are per deliverable set, exclusive of GST. Extra revisions and extended rights can be added at checkout. Sample pricing for demonstration.</p>
          </div>

          <div class="p-pane" id="pane-reviews" hidden>
            <p class="demo-note"><i data-lucide="info"></i>These reviews are fictional samples written for the demo, not feedback from real brands.</p>
            <div class="panel review-sum">
              <div class="big-rating"><b>${c.rating}</b>${stars(c.rating)}<small>${c.reviews} reviews</small></div>
              <div class="rbars">${ratingBars.map(([s, v]) => `<div class="hbar"><span>${s}★</span><div><i style="width:${v}%"></i></div><b>${v}%</b></div>`).join('')}</div>
            </div>
            ${c.reviewList.map(r => {
              const camp = brandByName(r.brand);
              return `<div class="review">
                ${brandLogo(r.brand, camp?.color || 'var(--grad)', 40)}
                <div><div class="review-top"><b>${esc(r.brand)}</b>${stars(r.stars)}<small class="muted">${r.ago}</small></div><p>${esc(r.text)}</p></div>
              </div>`;
            }).join('')}
          </div>
        </div>

        <aside class="pkg-card panel" id="pkgCard">
          <div class="pkg-tabs">${c.packages.map((p, i) => `<button class="${i === 1 ? 'on' : ''}" data-pkg="${i}">${p.tier}</button>`).join('')}</div>
          <div id="pkgBody">${pkgBody(c, 1)}</div>
          <button class="btn soft block" data-fit="${c.id}" style="margin-top:10px"><i data-lucide="bot"></i>AI: Is this creator right for my brand?</button>
          <p class="pkg-safe"><i data-lucide="info"></i>Sample creator: requests are saved to your account, not delivered.</p>
        </aside>
      </div>

      <section class="block">
        <div class="block-head"><h2>Similar creators</h2><a class="link" href="#/explore">View all <i data-lucide="arrow-right"></i></a></div>
        <div class="c-grid">${similar.map(creatorCard).join('')}</div>
      </section>
    </section>`;
  }

  // Teaser shown when the visitor is signed out or has used their profile-view allowance
  function renderProfileLocked(id) {
    const c = byId[id];
    return `
    <section class="profile">
      <div class="p-cover"><img src="${c.cover}" alt="" /></div>
      <div class="p-head">
        <img class="p-avatar" src="${c.avatar}" alt="${esc(c.name)}" />
        <div class="p-id"><h1>${esc(c.name)}</h1><p class="muted">${NICHE_LABEL[c.category]} · ${esc(c.city)}, India</p></div>
      </div>
      <div class="locked-box panel">
        <span class="hs-ico violet"><i data-lucide="crown"></i></span>
        <div>
          <h2>You've used this month's free profile views</h2>
          <p class="muted">Upgrade to Premium for unlimited profile views, or come back when your allowance resets. Profiles you already opened stay available this session.</p>
          <div class="head-actions"><a class="btn primary" href="#/pricing"><i data-lucide="crown"></i>Upgrade to Premium</a><a class="btn soft" href="#/explore">Back to creators</a></div>
        </div>
      </div>
    </section>`;
  }

  function pkgBody(c, i) {
    const p = c.packages[i];
    return `
      <div class="pkg-top"><h3>${esc(p.title)}</h3><b class="pkg-price">${inr(p.price)}</b></div>
      ${p.popular ? '<span class="pill-pop"><i data-lucide="flame"></i>Most booked</span>' : ''}
      <div class="pkg-meta"><span><i data-lucide="clock"></i>${p.days}-day delivery</span><span><i data-lucide="refresh-cw"></i>${esc(p.revisions)}</span><span><i data-lucide="file-badge"></i>${esc(p.rights)}</span></div>
      <ul class="pkg-list">${p.items.map(it => `<li><i data-lucide="check"></i>${esc(it)}</li>`).join('')}</ul>
      <button class="btn primary block lg" data-request="${c.id}" data-tier="${i}"><i data-lucide="send"></i>Request this package · ${inr(p.price)}</button>`;
  }

  function wireProfile(id) {
    const c = byId[id];
    if (!c) return;
    $('#pTabs').addEventListener('click', e => {
      const b = e.target.closest('[data-ptab]'); if (!b) return;
      $$('#pTabs button').forEach(x => x.classList.toggle('on', x === b));
      $$('.p-pane').forEach(p => { p.hidden = p.id !== 'pane-' + b.dataset.ptab; });
    });
    $('#pkgCard').addEventListener('click', e => {
      const b = e.target.closest('[data-pkg]'); if (!b) return;
      $$('#pkgCard [data-pkg]').forEach(x => x.classList.toggle('on', x === b));
      $('#pkgBody').innerHTML = pkgBody(c, +b.dataset.pkg);
      icons();
    });
  }

  /* ======================================================
     AI MATCHMAKER
     ====================================================== */
  // AI shortlist for a posted campaign (falls back to keyword scoring if the AI is unavailable)
  async function runMatch(brief, budget, out, btn) {
    if (!brief) return;
    const pool = CREATORS.filter(c => !budget || c.priceFrom <= budget);
    out.innerHTML = Array.from({ length: 3 }, () => '<div class="skeleton" style="height:110px"></div>').join('');
    setBusy(btn, true, 'Matching…');
    let results;
    try {
      const roster = pool.map(c => `${c.id} | ${c.name} | ${catById[c.category].name} | ${c.city} | ${compact(c.followers)} followers on ${Object.keys(c.platforms).join('/')} | ${c.engagement}% eng | ★${c.rating} | from ₹${c.priceFrom} | ${c.tags.join(', ')}`).join('\n');
      const text = await AI.chat([
        { role: 'system', content: 'You are an influencer-marketing strategist. Pick the best creators for a brief from the roster. Respond with ONLY a JSON array of exactly 3 objects: {"id": roster id, "score": 0-100 fit score, "reason": one persuasive sentence citing audience, niche or metrics}. Best first.' },
        { role: 'user', content: `Brief: ${brief}\n\nRoster (id | name | niche | city | reach | engagement | rating | price | tags):\n${roster}` },
      ]);
      results = AI.extractJSON(text).filter(r => byId[r.id]).slice(0, 3);
      if (!results.length) throw new Error('no matches');
    } catch {
      // Offline fallback: keyword relevance + quality score
      const words = brief.toLowerCase().split(/\W+/).filter(w => w.length > 3);
      results = pool.map(c => {
        const hay = [catById[c.category].name, c.city, c.bio, ...c.tags].join(' ').toLowerCase();
        const hits = words.filter(w => hay.includes(w)).length;
        return { id: c.id, score: Math.min(97, 55 + hits * 12 + c.engagement), reason: `${catById[c.category].name} creator with ${c.engagement}% engagement and ${compact(c.followers)} reach.` };
      }).sort((a, b) => b.score - a.score).slice(0, 3);
    }
    setBusy(btn, false);
    out.innerHTML = `<p class="mm-label"><i data-lucide="sparkles"></i>Top matches for your brief</p>` + results.map((r, i) => {
      const c = byId[r.id];
      const score = Math.max(0, Math.min(100, Math.round(+r.score || 80)));
      return `
      <div class="match" style="animation-delay:${i * 90}ms">
        <div class="score-ring" style="--s:${score}"><b>${score}</b><small>fit</small></div>
        <img src="${c.avatar}" alt="" class="match-av" />
        <div class="match-info">
          <div class="c-name">${esc(c.name)} <span class="c-cat sm">${catById[c.category].name}</span></div>
          <p>${esc(r.reason)}</p>
          <small class="muted">${compact(c.followers)} followers · ${c.engagement}% eng · ★ ${c.rating} · from ${inr(c.priceFrom)}</small>
        </div>
        <div class="match-act">
          <button class="btn soft" data-goto="#/creator/${c.id}">View</button>
          <button class="btn primary" data-goto-request="${c.id}">Request</button>
        </div>
      </div>`;
    }).join('');
    icons();
    out.onclick = e => {
      const g = e.target.closest('[data-goto]'), rq = e.target.closest('[data-goto-request]');
      if (g) { closeModal(); location.hash = g.dataset.goto; }
      if (rq) { closeModal(); openRequest(rq.dataset.gotoRequest); }
    };
  }

  /* AI brand-fit check on a profile */
  function openFitCheck(id) {
    const c = byId[id];
    const body = openModal(`
      <div class="modal-head"><div class="bk-who"><img src="${c.avatar}" alt=""><div><b>AI fit check</b><small>${esc(c.name)} · ${catById[c.category].name}</small></div></div><button class="icon-btn" data-close><i data-lucide="x"></i></button></div>
      <form id="fitForm">
        <label class="field-label" for="fitBrand">About your brand & campaign</label>
        <textarea id="fitBrand" rows="3" required placeholder="e.g. We're an affordable skincare brand for college students, launching a sunscreen in November."></textarea>
        <button class="btn primary lg" id="fitGo"><i data-lucide="sparkles"></i>Analyze fit</button>
      </form>
      <div id="fitOut" class="fit-out"></div>`);
    body.onclick = e => { if (e.target.closest('[data-close]')) closeModal(); };
    $('#fitForm').addEventListener('submit', async e => {
      e.preventDefault();
      const out = $('#fitOut'), btn = $('#fitGo');
      setBusy(btn, true, 'Analyzing…');
      out.innerHTML = '<div class="thinking"><span class="dots"><i></i><i></i><i></i></span>Reviewing audience, content style and pricing…</div>';
      try {
        await AI.chat([
          { role: 'system', content: 'You are an influencer-marketing analyst. Assess creator–brand fit in Markdown: start with "### Fit score: X/10", then "**Why it works**" (3 bullets), "**Watch-outs**" (2 bullets), "**Content ideas**" (3 bullets), and "**Recommended package**" (one line). Be specific and concise.' },
          { role: 'user', content: `Brand: ${$('#fitBrand').value}\n\nCreator: ${c.name}, ${catById[c.category].name} creator in ${c.city}. Bio: ${c.bio}. Platforms: ${Object.entries(c.platforms).map(([p, n]) => `${p} ${compact(n)}`).join(', ')}. Engagement ${c.engagement}%. Rating ${c.rating}. Tags: ${c.tags.join(', ')}. Languages: ${c.languages.join(', ')}. Packages: ${c.packages.map(p => `${p.tier} ₹${p.price} (${p.title})`).join('; ')}.` },
        ], { onToken: (_, full) => { out.innerHTML = mdToHtml(full); } });
      } catch (err) { out.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
      finally { setBusy(btn, false); }
    });
  }

  /* ======================================================
     CAMPAIGNS (Supabase: campaigns, applications, collab_requests)
     ====================================================== */
  function renderCampaigns() {
    const r = role();
    return `
    <section class="camp-hero">
      <div class="camp-hero-copy">
        <span class="pill-badge"><i data-lucide="megaphone"></i>Campaigns</span>
        <h1>${r === 'creator' ? 'Paid campaigns from brands looking for you' : 'Post a campaign brief, get creator pitches'}</h1>
        <p class="muted">${r === 'creator' ? 'Apply with a pitch tailored to each brand. AI can draft it for you.' : 'Describe what you need, review applications, and invite creators with collaboration requests.'}</p>
        ${r === 'creator' ? '' : '<button class="btn primary" data-new-campaign><i data-lucide="plus"></i>Create Campaign</button>'}
      </div>
      <img src="${U('1600880292203-757bb62b4baf', 900)}" alt="Team planning a content campaign" />
    </section>
    <div id="mineBox">${B.session ? '<div class="skeleton" style="height:150px;margin-bottom:18px"></div>' : ''}</div>
    <h2 class="h-sec">Campaign board</h2>
    <div class="explore-bar">
      <div class="search-sm"><i data-lucide="search"></i><input id="campQ" value="${esc(S.campQ)}" placeholder="Search campaigns or brands…" aria-label="Search campaigns" /></div>
      <select id="campStatus" aria-label="Status">${[['all', 'All statuses'], ['Open', 'Open'], ['In review', 'In review'], ['Closing soon', 'Closing soon']].map(([v, l]) => `<option value="${v}" ${S.campStatus === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="cat-chips" id="campCats">
      <button class="${S.campFilter === 'all' ? 'on' : ''}" data-cf="all"><i data-lucide="layout-grid"></i>All</button>
      ${CATEGORIES.map(c => `<button class="${S.campFilter === c.id ? 'on' : ''}" data-cf="${c.id}"><i data-lucide="${c.icon}"></i>${c.name}</button>`).join('')}
    </div>
    <p class="sample-line">${sampleNote('Campaigns marked "Sample brief" are examples. Member campaigns come from real brand accounts.')}</p>
    <div class="camp-grid" id="campList"></div>`;
  }

  function myCampaignsPanel() {
    if (role() === 'creator') {
      return `<div class="panel mine-single">
        <div class="panel-head"><h3>My applications</h3><a class="link" href="#/account">Edit creator profile <i data-lucide="arrow-right"></i></a></div>
        ${S.myApplications.length ? S.myApplications.map(a => `<div class="mini-camp" data-campaign="${a.campaign_id}" tabindex="0"><div><b>${esc(a.campaigns?.title || 'Campaign')}</b>
          <small class="muted">${esc(a.campaigns?.brand_name || '')} · your rate ${inr(a.rate)} · ${timeAgo(new Date(a.created_at).getTime())} ago</small></div>
          <span class="status-pill ${a.status === 'accepted' || a.status === 'shortlisted' ? 'ok' : ''}">${esc(a.status)}</span></div>`).join('')
          : '<div class="empty-inline"><i data-lucide="send"></i><p>You haven\'t applied yet. Open a member campaign below to apply.</p></div>'}
      </div>`;
    }
    const reqs = S.requests;
    return `
    <div class="mine-grid">
      <div class="panel">
        <div class="panel-head"><h3>Your campaigns</h3><button class="link" data-new-campaign><i data-lucide="plus"></i>New</button></div>
        ${S.myCampaigns.length ? `<div class="table-wrap"><table class="svc-table">
          <thead><tr><th>Campaign</th><th>Status</th><th>Category</th><th>Budget</th><th>Applications</th></tr></thead>
          <tbody>${S.myCampaigns.map(fromDb).map(c => `<tr class="row-link" data-campaign="${c.id}" tabindex="0">
            <td><b>${esc(c.title)}</b><small>Due ${esc(c.deadline)} · ${c.deliverables.length} deliverable${c.deliverables.length === 1 ? '' : 's'}</small></td>
            <td><span class="camp-status inline ${statusTone(c.status)}">${esc(c.status)}</span></td>
            <td>${NICHE_LABEL[c.category]}</td><td>${inr(c.budget[0])}–${inr(c.budget[1])}</td>
            <td>${c.applications?.length || 0}${c.applications?.some(a => a.status === 'pending') ? ' <span class="new-dot" title="Awaiting review"></span>' : ''}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty-inline"><i data-lucide="megaphone"></i><p>No campaigns yet. Create a brief and invite creators.</p><button class="btn primary" data-new-campaign>Create Campaign</button></div>'}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Collaboration requests</h3><a class="link" href="#/match">Find creators <i data-lucide="arrow-right"></i></a></div>
        ${reqs.length ? reqs.slice(0, 6).map(r => {
          const c = byId[r.creator_ref];
          return `<a class="mini-creator" href="#/creator/${esc(r.creator_ref)}">${c ? `<img class="av" src="${c.avatar}" alt="">` : ''}<div><b>${esc(r.creator_name)}</b><small class="muted">${inr(r.budget)} · go-live ${fmtShort(r.go_live)}</small></div><span class="status-pill">${esc(r.status)}</span></a>`;
        }).join('') : '<div class="empty-inline"><i data-lucide="send"></i><p>Requests you send to creators appear here.</p></div>'}
      </div>
    </div>`;
  }

  function renderCampList() {
    const q = S.campQ.toLowerCase();
    const list = allCampaigns().filter(c => (S.campFilter === 'all' || c.category === S.campFilter)
      && (S.campStatus === 'all' || c.status === S.campStatus)
      && (!q || (c.title + c.brand + c.brief).toLowerCase().includes(q)));
    $('#campList').innerHTML = list.length ? list.map(campaignCard).join('') : '<div class="empty-big"><div class="empty-art"><i data-lucide="search-x"></i></div><h3>No campaigns found</h3><p class="muted">Try another category, status or search term.</p></div>';
    icons();
  }

  async function loadCampaignData() {
    if (!B.configured || !B.session) return;
    if (B.dbMissing) { S.requests = store.get('localRequests', []); return; }
    const r = role();
    const [open, mine, apps, reqs] = await Promise.all([
      B.db.openCampaigns(),
      r === 'brand' ? B.db.myCampaigns() : [],
      r === 'creator' ? B.db.myApplications() : [],
      r === 'brand' ? B.db.requests() : [],
    ]);
    Object.assign(S, { dbCampaigns: open, myCampaigns: mine, myApplications: apps, requests: reqs });
  }

  async function wireCampaigns() {
    $('#campQ').addEventListener('input', e => { S.campQ = e.target.value; renderCampList(); });
    $('#campStatus').addEventListener('change', e => { S.campStatus = e.target.value; renderCampList(); });
    $('#campCats').addEventListener('click', e => {
      const b = e.target.closest('[data-cf]'); if (!b) return;
      S.campFilter = b.dataset.cf;
      $$('#campCats button').forEach(x => x.classList.toggle('on', x === b));
      renderCampList();
    });
    renderCampList();
    try {
      await loadCampaignData();
      if (!$('#campList')) return;
      if (B.session && role()) $('#mineBox').innerHTML = myCampaignsPanel();
      else $('#mineBox').innerHTML = '';
      renderCampList();
    } catch (err) {
      $('#mineBox').innerHTML = `<p class="form-msg">${esc(err.message)}</p>`;
    }
  }

  const APP_STATUS_ACTIONS = [['shortlisted', 'Shortlist'], ['accepted', 'Accept'], ['declined', 'Decline']];

  function openCampaign(id) {
    const c = campaignById(id);
    if (!c) return toast('Campaign not found', 'err');
    const mine = c.db && c.owner_id === uidNow();
    const app = S.myApplications.find(a => a.campaign_id === c.id);
    const r = role();
    let action;
    if (c.sample) {
      action = `<p class="demo-note"><i data-lucide="info"></i>This is a sample brief for inspiration. Applications are only accepted on member campaigns.</p>
        ${r !== 'creator' ? '<div class="modal-foot"><button class="btn primary" data-camp-match><i data-lucide="bot"></i>AI: find creators for this brief</button></div><div id="campMatch" class="mm-out"></div>' : ''}`;
    } else if (mine) {
      const apps = c.applications || [];
      action = `
        <div class="row-2 owner-tools"><div class="field"><label class="field-label" for="cStatus">Campaign status</label>
          <select id="cStatus">${['open', 'in_review', 'closed', 'draft'].map(s => `<option value="${s}" ${c.rawStatus === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select></div>
          <div class="field"><label class="field-label">&nbsp;</label><a class="btn outline block" href="#/match" data-close><i data-lucide="sparkles"></i>Find creators with AI Matching</a></div></div>
        <h3 class="cd-h">Applications (${apps.length})</h3>
        ${apps.length ? apps.map(a => `<div class="app-row" data-app="${a.id}">
          <div class="app-top"><b>${esc(a.creator_name)}</b><span class="status-pill ${a.status === 'accepted' || a.status === 'shortlisted' ? 'ok' : ''}">${esc(a.status)}</span><b class="order-amt">${inr(a.rate)}</b></div>
          <p class="muted">${esc(a.pitch)}</p>
          ${a.status === 'withdrawn' ? '' : `<div class="head-actions">${APP_STATUS_ACTIONS.filter(([s]) => s !== a.status).map(([s, l]) => `<button class="btn ${s === 'accepted' ? 'primary' : 'soft'} sm" data-app-status="${s}">${l}</button>`).join('')}</div>`}
        </div>`).join('') : '<p class="muted sm-text">No applications yet. Creators are notified about new open campaigns when they browse the board.</p>'}`;
    } else if (r === 'creator') {
      action = app ? `<div class="applied-box"><i data-lucide="check-circle-2"></i><div><b>You applied · ${esc(app.status)}</b><small>Your rate: ${inr(app.rate)}. You'll get a notification and email when ${esc(c.brand)} responds.</small></div></div>`
        : c.rawStatus !== 'open' ? '<p class="demo-note"><i data-lucide="info"></i>This campaign is not accepting applications right now.</p>'
        : `<form id="applyForm" class="apply-form" novalidate>
            <div class="field"><label class="field-label" for="apRate">Your rate (₹)</label>
            <input id="apRate" type="number" value="${Math.round((c.budget[0] + c.budget[1]) / 2 / 500) * 500}" min="500" step="500" /></div>
            <div class="field"><label class="field-label" for="apPitch">Your pitch</label>
            <div class="prompt-wrap"><textarea id="apPitch" rows="6" placeholder="Why you're the right creator for this campaign…"></textarea>
              <button type="button" class="enhance" id="apAI"><i data-lucide="wand-2"></i>Write my pitch with AI</button></div></div>
            <p class="form-msg" id="apMsg" role="alert" hidden></p>
            <button class="btn primary block lg" id="apGo"><i data-lucide="send"></i>Submit application</button>
          </form>`;
    } else {
      action = `<p class="demo-note"><i data-lucide="info"></i>${B.session ? 'Only creator accounts can apply to campaigns.' : 'Log in with a creator account to apply.'}</p>`;
    }

    const body = openModal(`
      <div class="cd-cover"><img src="${c.cover}" alt="" /><button class="icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button></div>
      <div class="camp-brand">${brandLogo(c.brand, c.color, 40)}<div><b>${esc(c.brand)}</b><small class="muted">${NICHE_LABEL[c.category]}${c.sample ? ' · sample brief' : ''}</small></div></div>
      <h2 class="cd-title">${esc(c.title)} <span class="camp-status inline ${statusTone(c.status)}">${esc(c.status || 'Open')}</span></h2>
      <div class="cd-facts">
        <div><small>Budget</small><b>${inr(c.budget[0])} – ${inr(c.budget[1])}</b></div>
        <div><small>Deadline</small><b>${esc(c.deadline)}</b></div>
        <div><small>Preferred category</small><b>${NICHE_LABEL[c.category]}</b></div>
        <div><small>Platforms</small><b class="c-plats">${c.platforms.map(p => `<i data-lucide="${PLATFORM_META[p].icon}" style="color:${PLATFORM_META[p].color}"></i>`).join('')}</b></div>
      </div>
      <h3 class="cd-h">The brief</h3><p>${esc(c.brief)}</p>
      <h3 class="cd-h">Deliverables</h3>
      <ul class="pkg-list">${c.deliverables.map(d => `<li><i data-lucide="check"></i>${esc(d)}</li>`).join('')}</ul>
      <div id="cdAction">${action}</div>`, { wide: true });

    body.onclick = async e => {
      if (e.target.closest('[data-close]')) return closeModal();
      const m = e.target.closest('[data-camp-match]');
      if (m) {
        if (!Account.gate({ why: 'use AI matching' }) || !(await Account.meter('ai_match'))) return;
        return runMatch(`${c.title}. ${c.brief} Platforms: ${c.platforms.join(', ')}. Budget ₹${c.budget[0]}–₹${c.budget[1]}.`, c.budget[1], $('#campMatch'), m);
      }
      if (e.target.closest('#apAI')) return aiPitch(c, e.target.closest('#apAI'));
      const st = e.target.closest('[data-app-status]');
      if (st) {
        const row = st.closest('[data-app]');
        setBusy(st, true, '…');
        try {
          await B.db.setApplicationStatus(row.dataset.app, st.dataset.appStatus);
          toast(`Application ${st.dataset.appStatus}. The creator has been notified.`);
          await loadCampaignData();
          openCampaign(c.id);
          if ($('#mineBox')) $('#mineBox').innerHTML = myCampaignsPanel();
          icons();
        } catch (err) { setBusy(st, false); toast(err.message, 'err'); }
      }
    };
    $('#cStatus')?.addEventListener('change', async e => {
      try { await B.db.updateCampaign(c.id, { status: e.target.value }); toast('Campaign status updated'); await loadCampaignData(); if ($('#campList')) { $('#mineBox').innerHTML = myCampaignsPanel(); renderCampList(); } }
      catch (err) { toast(err.message, 'err'); }
    });
    $('#applyForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      if (!validateAll([
        [$('#apRate'), () => (!(+$('#apRate').value >= 500) ? 'Enter a rate of at least ₹500.' : '')],
        [$('#apPitch'), () => ($('#apPitch').value.trim().length < 30 ? 'Write a pitch of at least 30 characters (or use AI).' : '')],
      ])) return;
      const btn = $('#apGo');
      setBusy(btn, true, 'Submitting…');
      try {
        await B.db.apply(c.id, +$('#apRate').value, $('#apPitch').value.trim());
        await loadCampaignData();
        closeModal();
        confetti();
        toast(`Application sent to ${c.brand}. We'll notify you when they respond.`);
        if ($('#campList')) { $('#mineBox').innerHTML = myCampaignsPanel(); renderCampList(); }
        loadUserData().then(renderChrome);
      } catch (err) {
        setBusy(btn, false);
        const m = $('#apMsg'); m.textContent = err.message; m.hidden = false;
      }
    });
  }

  async function aiPitch(c, btn) {
    const ta = $('#apPitch');
    setBusy(btn, true, 'Writing…');
    try {
      const cp = await B.db.creatorProfile().catch(() => null);
      await aiIntoTextarea(ta, [
        { role: 'system', content: 'You write short, confident pitches from content creators to brands. 90-120 words, first person, warm and specific, include a concrete content idea. Do not invent follower counts or statistics. Plain text, no subject line, no placeholders, no preamble.' },
        { role: 'user', content: `Creator: ${cp?.display_name || me().name}. ${cp ? `Niches: ${cp.niches.map(n => NICHE_LABEL[n]).join(', ')}. Languages: ${cp.languages.join(', ')}. Bio: ${cp.bio}` : ''}\n\nCampaign by ${c.brand}: ${c.title}. ${c.brief} Deliverables: ${c.deliverables.join('; ')}.` },
      ]);
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(btn, false); }
  }

  function openNewCampaign() {
    if (!Account.gate({ role: 'brand', why: 'create campaigns' })) return;
    const body = openModal(`
      <div class="modal-head"><h2><i data-lucide="megaphone"></i> Create a campaign</h2><button class="icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button></div>
      <form id="ncForm" novalidate>
        <div class="field"><label class="field-label" for="ncTitle">Campaign title</label>
        <input id="ncTitle" placeholder="e.g. Summer launch of our cold-brew coffee" /></div>
        <div class="row-2">
          <div class="field"><label class="field-label" for="ncCat">Preferred creator category</label><select id="ncCat">${CATEGORIES.map(c => `<option value="${c.id}">${NICHE_LABEL[c.id]}</option>`).join('')}</select></div>
          <div class="field"><label class="field-label" for="ncDeadline">Deadline</label><input id="ncDeadline" type="date" min="${new Date(Date.now() + DAY).toISOString().slice(0, 10)}" value="${new Date(Date.now() + 21 * DAY).toISOString().slice(0, 10)}" /></div>
        </div>
        <div class="row-2">
          <div class="field"><label class="field-label" for="ncMin">Budget from (₹)</label><input id="ncMin" type="number" value="10000" min="500" step="500" /></div>
          <div class="field"><label class="field-label" for="ncMax">Budget to (₹)</label><input id="ncMax" type="number" value="40000" min="500" step="500" /></div>
        </div>
        <div class="field"><label class="field-label">Platforms</label>
        <div class="chips-select" id="ncPlats">${Object.entries(PLATFORM_META).map(([id, p], i) => `<button type="button" data-id="${id}" class="${i < 2 ? 'on' : ''}"><i data-lucide="${p.icon}"></i>${p.name}</button>`).join('')}</div></div>
        <div class="field"><label class="field-label" for="ncBrief">Campaign brief</label>
        <div class="prompt-wrap">
          <textarea id="ncBrief" rows="4" placeholder="What should creators make? Who's the audience?"></textarea>
          <button type="button" class="enhance" id="ncAI"><i data-lucide="wand-2"></i>Write with AI</button>
        </div></div>
        <div class="field"><label class="field-label" for="ncDeliv">Deliverables <span class="opt">one per line</span></label>
        <textarea id="ncDeliv" rows="3" placeholder="1 Reel (30–60s)&#10;3 Stories with link&#10;30-day usage rights"></textarea></div>
        <p class="form-msg" id="ncMsg" role="alert" hidden></p>
        <div class="modal-foot"><button type="button" class="btn soft" data-close>Cancel</button><button class="btn primary" id="ncGo"><i data-lucide="rocket"></i>Publish campaign</button></div>
      </form>`);
    body.onclick = async e => {
      if (e.target.closest('[data-close]')) return closeModal();
      const p = e.target.closest('#ncPlats button');
      if (p) return p.classList.toggle('on');
      const ai = e.target.closest('#ncAI');
      if (ai) {
        const title = $('#ncTitle').value.trim();
        if (!title) { $('#ncTitle').focus(); return toast('Add a campaign title first', 'err'); }
        setBusy(ai, true, 'Writing…');
        try {
          await aiIntoTextarea($('#ncBrief'), [
            { role: 'system', content: 'Write a clear 2-3 sentence campaign brief that a brand posts for content creators: what to make, the vibe, and who it is for. Plain text, no preamble.' },
            { role: 'user', content: `Title: ${title}. Category: ${NICHE_LABEL[$('#ncCat').value]}. Budget ₹${$('#ncMin').value}–₹${$('#ncMax').value}.` },
          ]);
        } catch (err) { toast(err.message, 'err'); }
        finally { setBusy(ai, false); }
      }
    };
    $('#ncForm').addEventListener('submit', async e => {
      e.preventDefault();
      const min = +$('#ncMin').value, max = +$('#ncMax').value;
      const deliverables = $('#ncDeliv').value.split('\n').map(s => s.trim()).filter(Boolean);
      if (!validateAll([
        [$('#ncTitle'), () => ($('#ncTitle').value.trim().length < 5 ? 'Give the campaign a title (at least 5 characters).' : '')],
        [$('#ncDeadline'), () => (!$('#ncDeadline').value || new Date($('#ncDeadline').value) < new Date(new Date().toDateString()) ? 'Choose a deadline in the future.' : '')],
        [$('#ncMin'), () => (!(min >= 500) ? 'Minimum budget is ₹500.' : '')],
        [$('#ncMax'), () => (!(max >= min) ? 'Must be at least the "from" amount.' : '')],
        [$('#ncPlats'), () => (!$$('#ncPlats .on').length ? 'Pick at least one platform.' : '')],
        [$('#ncBrief'), () => ($('#ncBrief').value.trim().length < 30 ? 'Write a brief of at least 30 characters (or use AI).' : '')],
        [$('#ncDeliv'), () => (!deliverables.length ? 'List at least one deliverable.' : '')],
      ])) return;
      const btn = $('#ncGo'), msg = $('#ncMsg');
      setBusy(btn, true, 'Publishing…');
      try {
        await B.db.createCampaign({
          title: $('#ncTitle').value.trim(), brief: $('#ncBrief').value.trim(), category: $('#ncCat').value,
          budget_min: min, budget_max: max, platforms: $$('#ncPlats .on').map(b => b.dataset.id), deliverables, deadline: $('#ncDeadline').value,
        });
        closeModal();
        confetti();
        toast('Campaign published! We emailed you a confirmation.');
        await B.refresh();
        loadUserData().then(renderChrome);
        if (location.hash === '#/campaigns') route(); else location.hash = '#/campaigns';
      } catch (err) {
        setBusy(btn, false);
        if (err instanceof QuotaError) { closeModal(); return Account.upgradeDialog(err); }
        msg.textContent = err.message; msg.hidden = false;
      }
    });
  }

  /* ======================================================
     MESSAGES
     ====================================================== */
  function thread(role, partnerId) {
    const id = (role === 'brand' ? 'b-' : 'c-') + partnerId;
    let t = S.threads.find(x => x.id === id);
    if (!t) { t = { id, role, partnerId, messages: [], unread: false }; S.threads.unshift(t); }
    return t;
  }
  function partner(t) {
    if (t.role === 'brand') {
      const c = byId[t.partnerId];
      return { name: c.name, sub: `${catById[c.category].name} creator · ${esc(c.city)}`, avatar: `<img class="av" src="${c.avatar}" alt="">`, creator: c };
    }
    const camp = brandByName(t.partnerId);
    return { name: t.partnerId, sub: 'Brand · Marketing team', avatar: brandLogo(t.partnerId, camp?.color || 'var(--grad)', 42), campaign: camp };
  }

  function renderMessages(tid) {
    const list = S.threads.slice().sort((a, b) => (b.messages.at(-1)?.t || 0) - (a.messages.at(-1)?.t || 0));
    const member = tid && tid.startsWith('m-') ? tid.slice(2) : null;  // real member conversation
    const active = member ? null : list.find(t => t.id === tid);
    if (active) active.unread = false;
    persist();
    return `
    <section class="inbox ${active || member ? 'has-active' : ''}">
      <aside class="inbox-list panel">
        <h2>Messages</h2>
        <h3 class="inbox-sec">Members</h3>
        <div id="memberInbox"><div class="skeleton" style="height:70px"></div></div>
        <h3 class="inbox-sec">Demo chat <small class="muted">sample creators, AI replies</small></h3>
        ${list.length ? list.map(t => {
          const p = partner(t), last = t.messages.at(-1);
          return `<a class="thread ${t.id === tid ? 'on' : ''}" href="#/messages/${encodeURIComponent(t.id)}">
            ${p.avatar}
            <div class="th-main"><div class="th-top"><b>${esc(p.name)}</b><small>${last ? timeAgo(last.t) : ''}</small></div>
            <p>${last ? (last.from === 'me' ? 'You: ' : '') + esc(last.text.slice(0, 70)) : 'Start the conversation'}</p></div>
            ${t.unread ? '<i class="unread-dot"></i>' : ''}
          </a>`;
        }).join('') : '<p class="muted" style="padding:12px">No conversations yet. Message a creator from their profile.</p>'}
      </aside>
      <div class="chat panel">${member ? '<div id="memberChat" class="member-chat"><div class="skeleton" style="height:240px;margin:20px"></div></div>' : active ? chatPane(active) : `
        <div class="empty-big"><div class="empty-art"><i data-lucide="messages-square"></i></div><h3>Select a conversation</h3><p class="muted">Member conversations are private and saved to your account. Demo chats use AI-simulated replies and stay in this browser.</p></div>`}
      </div>
    </section>`;
  }

  function chatPane(t) {
    const p = partner(t);
    const quick = t.role === 'brand'
      ? ['Can you share your rate card?', 'Are you available next week?', 'Could you send a script draft?', 'What are your audience demographics?']
      : ['Thanks! Sharing my media kit now.', 'Can we discuss the budget?', 'What is the timeline?', 'Can I get the product in advance?'];
    return `
      <header class="chat-head">
        <a class="icon-btn back" href="#/messages" aria-label="Back"><i data-lucide="arrow-left"></i></a>
        ${p.avatar}
        <div><b>${esc(p.name)}</b><small class="online">● Online · ${p.sub}</small></div>
        <div class="chat-head-act">
          ${p.creator ? `<a class="btn soft" href="#/creator/${p.creator.id}">Profile</a><button class="btn primary" data-request="${p.creator.id}" data-tier="1">Request</button>` : ''}
        </div>
      </header>
      <div class="chat-body" id="chatBody">${t.messages.map(bubble).join('')}</div>
      <div class="quick">${quick.map(q => `<button class="chip" data-quick-reply="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form class="chat-input" id="chatForm" data-thread="${esc(t.id)}">
        <input id="chatText" placeholder="Write a message…" autocomplete="off" />
        <button class="btn primary" aria-label="Send"><i data-lucide="send"></i></button>
      </form>`;
  }
  const bubble = m => `<div class="bubble ${m.from === 'me' ? 'me' : ''}"><p>${esc(m.text)}</p><small>${m.auto ? 'auto-reply · ' : ''}${new Date(m.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>`;

  function wireMessages(tid) {
    const form = $('#chatForm');
    if (!form) return;
    const body = $('#chatBody');
    body.scrollTop = body.scrollHeight;
    const t = S.threads.find(x => x.id === tid);
    const send = async text => {
      text = text.trim(); if (!text) return;
      t.messages.push({ from: 'me', text, t: Date.now() });
      persist();
      body.insertAdjacentHTML('beforeend', bubble(t.messages.at(-1)));
      $('#chatText').value = '';
      body.insertAdjacentHTML('beforeend', '<div class="bubble typing" id="typing"><span class="dots"><i></i><i></i><i></i></span></div>');
      body.scrollTop = body.scrollHeight;
      await aiReply(t, body);
    };
    form.addEventListener('submit', e => { e.preventDefault(); send($('#chatText').value); });
    $('.quick').addEventListener('click', e => { const q = e.target.closest('[data-quick-reply]'); if (q) send(q.dataset.quickReply); });
    $('#chatText').focus();
  }

  async function aiReply(t, body) {
    const p = partner(t);
    let sys;
    if (p.creator) {
      const c = p.creator;
      sys = `You are ${c.name} (@${c.handle}), a ${catById[c.category].name} content creator from ${c.city}, India. Bio: ${c.bio} Reach: ${Object.entries(c.platforms).map(([k, n]) => `${compact(n)} on ${k}`).join(', ')}, ${c.engagement}% engagement. Packages: ${c.packages.map(x => `${x.tier} ₹${x.price} (${x.title}, ${x.days} days)`).join('; ')}. You are chatting with a brand on a creator marketplace. Reply in 1-3 short, friendly, professional sentences, like a real chat message. Never say you are an AI.`;
    } else {
      const camp = p.campaign;
      sys = `You are the influencer-marketing manager at ${t.partnerId}. ${camp ? `Your campaign: ${camp.title}. ${camp.brief} Budget ₹${camp.budget[0]}–₹${camp.budget[1]}.` : ''} You are chatting with a content creator named ${me().name}. Reply in 1-3 short, friendly, professional sentences. Never say you are an AI.`;
    }
    const history = t.messages.slice(-10).map(m => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text }));
    let el = null;
    try {
      const text = await AI.chat([{ role: 'system', content: sys }, ...history], {
        onToken: (_, full) => {
          if (!el) { $('#typing')?.remove(); body.insertAdjacentHTML('beforeend', bubble({ from: 'them', text: '', t: Date.now() })); el = body.lastElementChild.querySelector('p'); }
          el.textContent = full; body.scrollTop = body.scrollHeight;
        },
      });
      $('#typing')?.remove();
      t.messages.push({ from: 'them', text: text.trim(), t: Date.now() });
      if (!location.hash.includes(encodeURIComponent(t.id))) t.unread = true;
      persist();
      renderChrome();
    } catch (err) {
      // The free AI service is unavailable: answer from the sample profile's own data so the chat never goes silent
      console.warn('AI reply failed, using profile-based reply:', err.message);
      $('#typing')?.remove();
      el?.closest('.bubble')?.remove();
      const m = { from: 'them', text: quickReply(p, t), t: Date.now(), auto: true };
      t.messages.push(m);
      if (location.hash.includes(t.id)) { body.insertAdjacentHTML('beforeend', bubble(m)); body.scrollTop = body.scrollHeight; }
      else t.unread = true;
      persist();
      renderChrome();
    }
  }

  // Reply built from the sample creator's / brand's listed details (used when the AI service doesn't answer)
  function quickReply(p, t) {
    const q = (t.messages.filter(m => m.from === 'me').at(-1)?.text || '').toLowerCase();
    if (p.creator) {
      const c = p.creator, first = c.packages[0], fastest = Math.min(...c.packages.map(x => x.days));
      if (/price|rate|cost|budget|charge|fee|₹|how much|package/.test(q)) return `My packages: ${c.packages.map(x => `${x.tier} ₹${x.price.toLocaleString('en-IN')} (${x.title}, ${x.days} days)`).join('; ')}. Happy to adjust to your brief!`;
      if (/avail|free|when|date|time|week|schedule|deadline|start/.test(q)) return `Yes, I can take this on. Delivery is usually ${fastest}–${Math.max(...c.packages.map(x => x.days))} days after we finalise the brief. Share your go-live date and I'll confirm.`;
      if (/collab|work|campaign|brief|reel|video|post|promot/.test(q)) return `Sounds great! Please share the product, key message and deliverables. My ${first.tier} package starts at ₹${first.price.toLocaleString('en-IN')} (${first.title}), and I can tailor it for you.`;
      if (/^(hi|hello|hey|namaste)\b/.test(q)) return `Hi! Thanks for reaching out. I create ${catById[c.category].name.toLowerCase()} content from ${c.city}. How can I help with your campaign?`;
      return `Thanks for your message! I'll review it and get back to you. Packages start at ₹${first.price.toLocaleString('en-IN')} (${first.title}).`;
    }
    const camp = p.campaign;
    if (/price|rate|budget|pay|fee|₹/.test(q) && camp) return `Our budget for this campaign is ₹${camp.budget[0].toLocaleString('en-IN')}–₹${camp.budget[1].toLocaleString('en-IN')}, depending on deliverables.`;
    return camp ? `Thanks for your interest in "${camp.title}"! Could you share your rate card and a couple of recent posts?` : 'Thanks for reaching out! Could you share your rate card and a couple of recent posts?';
  }

  /* ======================================================
     DASHBOARD (signed-in users; data from Supabase)
     ====================================================== */
  function renderDashboard() {
    const r = role(), premium = B.tier === 'premium';
    return `
    <section class="page-head">
      <div><p class="eyebrow"><i data-lucide="${r === 'creator' ? 'video' : 'briefcase'}"></i>${r === 'creator' ? 'Creator' : 'Brand'} dashboard</p>
        <h1>Welcome back, ${esc(me().name.split(' ')[0])} 👋</h1>
        <p class="muted"><span class="plan-badge ${premium ? 'premium' : ''}"><i data-lucide="${premium ? 'crown' : 'leaf'}"></i>${premium ? 'Premium' : 'Free plan'}</span></p></div>
      <div class="head-actions">
        ${r === 'creator' ? '<a class="btn soft" href="#/account"><i data-lucide="user-round-pen"></i>Edit profile</a><a class="btn primary" href="#/campaigns"><i data-lucide="megaphone"></i>Find campaigns</a>'
          : '<a class="btn soft" href="#/explore"><i data-lucide="search"></i>Explore creators</a><button class="btn primary" data-new-campaign><i data-lucide="plus"></i>Create Campaign</button>'}
      </div>
    </section>
    <div class="dash-grid">
      <div class="panel">
        <div class="panel-head"><h3>Plan &amp; usage</h3><a class="link" href="#/billing">Billing <i data-lucide="arrow-right"></i></a></div>
        ${Account.usageMeters()}
        ${premium ? '' : '<a class="btn primary block" href="#/pricing" style="margin-top:14px"><i data-lucide="crown"></i>Upgrade to Premium</a>'}
      </div>
      <div class="panel" id="dashMain"><div class="skeleton" style="height:180px"></div></div>
      <div class="panel" id="dashSaved"><div class="skeleton" style="height:140px"></div></div>
      <div class="panel">
        <div class="panel-head"><h3>Notifications</h3><a class="link" href="#/notifications">All <i data-lucide="arrow-right"></i></a></div>
        <div id="dashNotifs"><div class="skeleton" style="height:140px"></div></div>
      </div>
      <div class="panel span-2">
        <div class="panel-head"><h3>Network</h3><a class="link" href="#/members${r === 'brand' ? '/creator' : ''}">${r === 'brand' ? 'Discover creators' : 'Discover members'} <i data-lucide="arrow-right"></i></a></div>
        <div class="quick-links network-links" id="dashNetwork">
          <a href="#/u/me"><i data-lucide="user-round"></i>${r === 'brand' ? 'Brand profile' : 'My profile'}</a>
          ${r === 'brand' ? '<a href="#/members/creator"><i data-lucide="search"></i>Discover creators</a>' : '<a href="#/members/brand"><i data-lucide="search"></i>Discover brands</a>'}
          <a href="#/requests"><i data-lucide="handshake"></i>Collaboration requests<em class="net-count" data-net="collabIn" hidden></em></a>
          <a href="#/messages"><i data-lucide="message-circle"></i>Messages<em class="net-count" data-net="unread" hidden></em></a>
          <a href="#/connections"><i data-lucide="users-round"></i>My connections<em class="net-count" data-net="connIn" hidden></em></a>
          <a href="#/notifications"><i data-lucide="bell"></i>Notifications</a>
        </div>
      </div>
      <div class="panel span-2 quick-links">
        <a href="#/explore"><i data-lucide="compass"></i>Explore Creators</a>
        <a href="#/match"><i data-lucide="sparkles"></i>AI Matching</a>
        <a href="#/campaigns"><i data-lucide="megaphone"></i>Campaigns</a>
        <a href="#/studio/posts"><i data-lucide="wand-2"></i>AI Content Studio</a>
        <a href="#/account"><i data-lucide="settings"></i>Account settings</a>
        ${B.isAdmin ? '<a href="#/admin"><i data-lucide="shield"></i>Admin</a>' : '<a href="#/messages"><i data-lucide="message-circle"></i>Demo chat</a>'}
      </div>
    </div>`;
  }

  async function wireDashboard() {
    const r = role();
    // network counts (pending requests, unread messages); failures here never block the dashboard
    Social.networkSummary().then(n => $$('[data-net]').forEach(el => { const v = n[el.dataset.net]; el.hidden = !v; el.textContent = v; })).catch(() => {});
    try {
      const [notifs, cp] = await Promise.all([B.db.notifications(5), r === 'creator' ? B.db.creatorProfile() : null, loadCampaignData(), loadUserData()]);
      if (!$('#dashMain')) return;
      $('#dashNotifs').innerHTML = notifs.length ? notifs.map(Account.notifItem).join('') : '<div class="empty-inline"><i data-lucide="bell-off"></i><p>No notifications yet.</p></div>';
      if (r === 'creator') {
        $('#dashMain').innerHTML = `
          <div class="panel-head"><h3>Creator profile</h3><a class="link" href="#/account">Edit <i data-lucide="arrow-right"></i></a></div>
          ${cp ? `<p><b>${esc(cp.display_name)}</b> · ${cp.niches.map(n => NICHE_LABEL[n]).join(', ') || 'no niche yet'}</p>
            <p class="muted sm-text">${cp.published ? '<span class="status-pill ok">Published</span> Brands can see your profile.' : '<span class="status-pill">Not published</span> Publish it from Account settings so brands can find you.'}</p>`
            : '<div class="empty-inline"><i data-lucide="user-round-plus"></i><p>Complete your creator profile so brands can find you.</p><a class="btn primary" href="#/onboarding">Complete profile</a></div>'}
          <div class="panel-head" style="margin-top:16px"><h3>My applications</h3><a class="link" href="#/campaigns">Browse <i data-lucide="arrow-right"></i></a></div>
          ${S.myApplications.slice(0, 4).map(a => `<div class="mini-camp" data-campaign="${a.campaign_id}" tabindex="0"><div><b>${esc(a.campaigns?.title || 'Campaign')}</b><small class="muted">${esc(a.campaigns?.brand_name || '')} · ${inr(a.rate)}</small></div><span class="status-pill ${a.status === 'accepted' || a.status === 'shortlisted' ? 'ok' : ''}">${esc(a.status)}</span></div>`).join('')
            || '<p class="muted sm-text">No applications yet.</p>'}`;
        const open = S.dbCampaigns.filter(c => !S.myApplications.some(a => a.campaign_id === c.id)).slice(0, 4).map(fromDb);
        $('#dashSaved').innerHTML = `<div class="panel-head"><h3>Open campaigns</h3><a class="link" href="#/campaigns">All <i data-lucide="arrow-right"></i></a></div>
          ${open.length ? open.map(c => `<div class="mini-camp" data-campaign="${c.id}" tabindex="0"><img src="${c.cover}" alt=""><div><b>${esc(c.title)}</b><small class="muted">${esc(c.brand)} · ${inr(c.budget[0])}–${inr(c.budget[1])}</small></div><i data-lucide="chevron-right"></i></div>`).join('')
            : '<div class="empty-inline"><i data-lucide="megaphone"></i><p>No member campaigns are open right now. Check back soon.</p></div>'}`;
      } else {
        $('#dashMain').innerHTML = `
          <div class="panel-head"><h3>Your campaigns</h3><button class="link" data-new-campaign>New <i data-lucide="plus"></i></button></div>
          ${S.myCampaigns.length ? S.myCampaigns.slice(0, 5).map(fromDb).map(c => `<div class="mini-camp" data-campaign="${c.id}" tabindex="0"><img src="${c.cover}" alt=""><div><b>${esc(c.title)}</b><small class="muted">${esc(c.status)} · ${c.applications?.length || 0} applications · due ${esc(c.deadline)}</small></div><i data-lucide="chevron-right"></i></div>`).join('')
            : '<div class="empty-inline"><i data-lucide="megaphone"></i><p>Create a campaign brief and let creators apply.</p><button class="btn primary" data-new-campaign>Create Campaign</button></div>'}
          <div class="panel-head" style="margin-top:16px"><h3>Collaboration requests</h3></div>
          ${S.requests.slice(0, 3).map(q => `<div class="mini-creator"><div><b>${esc(q.creator_name)}</b><small class="muted">${inr(q.budget)} · go-live ${fmtShort(q.go_live)}</small></div><span class="status-pill">${esc(q.status)}</span></div>`).join('') || '<p class="muted sm-text">No requests sent yet.</p>'}`;
        const saved = [...S.saved].map(id => byId[id]).filter(Boolean);
        $('#dashSaved').innerHTML = `<div class="panel-head"><h3>Saved creators</h3><a class="link" href="#/saved">All <i data-lucide="arrow-right"></i></a></div>
          ${saved.length ? saved.slice(0, 5).map(c => `<a class="mini-creator" href="#/creator/${c.id}"><img class="av" src="${c.avatar}" alt=""><div><b>${esc(c.name)}</b><small class="muted">${NICHE_LABEL[c.category]} · ${compact(c.followers)}</small></div><span>from ${inr(c.priceFrom)}</span></a>`).join('')
            : '<p class="muted">Tap ♡ on any creator to save them here.</p>'}`;
      }
      icons();
    } catch (err) {
      if ($('#dashMain')) $('#dashMain').innerHTML = `<p class="form-msg">${esc(err.message)}</p>`;
    }
  }

  /* ======================================================
     AI MATCHING (transparent rule-based scoring + optional AI summary)
     ====================================================== */
  const CONTENT_TYPES = ['Reels / short video', 'Long-form video', 'Static posts / carousels', 'Live stream', 'Written threads / articles', 'UGC for ads'];
  const OBJECTIVES = ['Product launch', 'Brand awareness', 'Drive sales', 'App installs', 'Event promotion'];
  const WEIGHTS = { niche: 30, platform: 20, budget: 20, language: 15, keywords: 10, engagement: 5 };

  function scoreCreator(c, m) {
    const reasons = [];
    const label = NICHE_LABEL[c.category];
    let niche;
    if (m.niche === 'any') { niche = 20; reasons.push(['neutral', 'Any niche accepted']); }
    else if (c.category === m.niche) { niche = 30; reasons.push(['ok', `${label} niche matches`]); }
    else { niche = 0; reasons.push(['no', `Niche is ${label}`]); }

    let platform = 20;
    if (m.platform !== 'any') {
      platform = c.platforms[m.platform] ? 20 : 0;
      reasons.push(c.platforms[m.platform] ? ['ok', `Active on ${PLATFORM_META[m.platform].name} (${compact(c.platforms[m.platform])})`] : ['no', `Not on ${PLATFORM_META[m.platform].name}`]);
    }
    let language = 15;
    if (m.language !== 'any') {
      language = c.languages.includes(m.language) ? 15 : 0;
      reasons.push(language ? ['ok', `Creates in ${m.language}`] : ['no', `Doesn't list ${m.language}`]);
    }
    const b = budgetById[m.budget];
    let budget = 20, budgetFit = 'ok';
    if (m.budget !== 'any') {
      if (c.priceFrom >= b.min && c.priceFrom <= b.max) budget = 20;
      else if (c.priceFrom < b.min) { budget = 16; budgetFit = 'under'; }
      else if (c.priceFrom <= b.max * 1.25) { budget = 8; budgetFit = 'partial'; }
      else { budget = 0; budgetFit = 'no'; }
      reasons.push([budgetFit === 'no' ? 'no' : budgetFit === 'partial' ? 'neutral' : 'ok',
        `Starts at ${inr(c.priceFrom)}${budgetFit === 'ok' ? ', within budget' : budgetFit === 'under' ? ', below your budget range' : budgetFit === 'partial' ? ', slightly over budget' : ', over budget'}`]);
    }
    const words = `${m.product} ${m.audience}`.toLowerCase().split(/[^a-z0-9ऀ-෿]+/).filter(w => w.length > 3);
    const hay = [label, c.bio, c.city, ...c.tags].join(' ').toLowerCase();
    const hits = [...new Set(words.filter(w => hay.includes(w)))];
    const keywords = Math.min(10, hits.length * 4);
    if (hits.length) reasons.push(['ok', `Profile mentions “${hits.slice(0, 3).join('”, “')}”`]);
    const engagement = Math.min(5, Math.round(c.engagement / 2));
    reasons.push(['ok', `${c.engagement}% sample engagement rate`]);

    const parts = { niche, platform, budget, language, keywords, engagement };
    const score = Object.values(parts).reduce((a, b2) => a + b2, 0);
    return {
      c, score, parts, reasons,
      compat: {
        budget: m.budget === 'any' || budgetFit === 'under' ? 'ok' : budgetFit,
        platform: m.platform === 'any' || c.platforms[m.platform] ? 'ok' : 'no',
        language: m.language === 'any' || c.languages.includes(m.language) ? 'ok' : 'no',
      },
    };
  }

  function renderMatch() {
    const m = S.match || {};
    const sel = (id, opts, cur, any) => `<select id="${id}">${any ? `<option value="any">${any}</option>` : ''}${opts.map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    return `
    <section class="page-head">
      <div>
        <span class="pill-badge"><i data-lucide="sparkles"></i>AI Matching</span>
        <h1>Match your campaign with the right creators</h1>
        <p class="muted">Describe the campaign and every creator is ranked with a transparent score. Optionally, ask the AI model to write a recommendation.</p>
      </div>
    </section>
    <div class="match-layout">
      <form class="panel match-form" id="matchForm" novalidate>
        <div class="field"><label class="field-label" for="mName">Campaign name</label><input id="mName" value="${esc(m.name || '')}" placeholder="e.g. Monsoon skincare launch" /></div>
        <div class="field"><label class="field-label" for="mProduct">Product or service</label><input id="mProduct" value="${esc(m.product || '')}" placeholder="e.g. Lightweight gel moisturiser" /></div>
        <div class="row-2">
          <div class="field"><label class="field-label" for="mObjective">Objective</label>${sel('mObjective', OBJECTIVES.map(o => [o, o]), m.objective)}</div>
          <div class="field"><label class="field-label" for="mType">Content type</label>${sel('mType', CONTENT_TYPES.map(o => [o, o]), m.ctype)}</div>
        </div>
        <div class="field"><label class="field-label" for="mAudience">Target audience</label><input id="mAudience" value="${esc(m.audience || '')}" placeholder="e.g. College students in Hyderabad who love fitness" /></div>
        <div class="row-2">
          <div class="field"><label class="field-label" for="mNiche">Required niche</label>${sel('mNiche', CATEGORIES.map(c => [c.id, NICHE_LABEL[c.id]]), m.niche, 'Any niche')}</div>
          <div class="field"><label class="field-label" for="mPlatform">Preferred platform</label>${sel('mPlatform', Object.entries(PLATFORM_META).map(([id, p]) => [id, p.name]), m.platform, 'Any platform')}</div>
        </div>
        <div class="row-2">
          <div class="field"><label class="field-label" for="mLang">Required language</label>${sel('mLang', LANGUAGES.map(l => [l, l]), m.language, 'Any language')}</div>
          <div class="field"><label class="field-label" for="mBudget">Budget per creator</label>${sel('mBudget', BUDGETS.slice(1).map(b => [b.id, b.name]), m.budget, 'Any budget')}</div>
        </div>
        <button class="btn primary block lg" id="mGo"><i data-lucide="sparkles"></i>Find matching creators</button>
        <details class="how-score">
          <summary><i data-lucide="calculator"></i>How the match score works</summary>
          <ul>
            <li><b>${WEIGHTS.niche}</b> niche (20 if “any”)</li><li><b>${WEIGHTS.platform}</b> platform</li><li><b>${WEIGHTS.budget}</b> budget fit</li>
            <li><b>${WEIGHTS.language}</b> language</li><li><b>${WEIGHTS.keywords}</b> profile keywords from product &amp; audience</li><li><b>${WEIGHTS.engagement}</b> engagement</li>
          </ul>
          <p>Rule-based and deterministic: no trained model decides the ranking. The optional AI summary uses a general-purpose language model via Pollinations.ai.</p>
        </details>
      </form>
      <div id="matchOut" class="match-out" aria-live="polite">${S.matchResults ? matchResultsHtml(S.matchResults) : `
        <div class="empty-big">
          <div class="empty-art"><i data-lucide="target"></i></div>
          <h3>Your ranked creators will appear here</h3>
          <p class="muted">Fill in the campaign details. Campaign name and product are required.</p>
        </div>`}</div>
    </div>`;
  }

  function matchResultsHtml(results) {
    const chip = (k, v) => `<span class="compat ${v}"><i data-lucide="${v === 'ok' ? 'check' : v === 'partial' ? 'minus' : 'x'}"></i>${k}</span>`;
    return `
      <div class="match-top">
        <p class="mm-label"><i data-lucide="list-ordered"></i>Top ${results.length} matches for “${esc(S.match.name)}”</p>
        <button class="btn soft" id="aiSummary"><i data-lucide="bot"></i>AI recommendation</button>
      </div>
      <div id="aiSummaryOut"></div>
      ${results.map((r, i) => `
      <article class="mcard" style="animation-delay:${i * 60}ms">
        <div class="score-ring" style="--s:${r.score}" aria-label="Match score ${r.score} out of 100"><b>${r.score}</b><small>/100</small></div>
        <img src="${r.c.avatar}" alt="" class="match-av" />
        <div class="match-info">
          <div class="c-name"><a href="#/creator/${r.c.id}">${esc(r.c.name)}</a><span class="c-cat sm">${NICHE_LABEL[r.c.category]}</span></div>
          <div class="compat-row">${chip('Budget', r.compat.budget)}${chip('Platform', r.compat.platform)}${chip('Language', r.compat.language)}</div>
          <ul class="reasons">${r.reasons.map(([t, txt]) => `<li class="${t}"><i data-lucide="${t === 'ok' ? 'check' : t === 'no' ? 'x' : 'minus'}"></i>${esc(txt)}</li>`).join('')}</ul>
        </div>
        <div class="match-act col">
          <a class="btn outline sm" href="#/creator/${r.c.id}">View Profile</a>
          <button class="btn soft sm ${S.saved.has(r.c.id) ? 'on' : ''}" data-save="${r.c.id}"><i data-lucide="heart"></i><span>${S.saved.has(r.c.id) ? 'Saved' : 'Save'}</span></button>
          <button class="btn primary sm" data-request="${r.c.id}"><i data-lucide="send"></i>Send request</button>
        </div>
      </article>`).join('')}`;
  }

  function wireMatch() {
    const form = $('#matchForm');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!validateAll([
        [$('#mName'), () => $('#mName').value.trim().length < 3 ? 'Give your campaign a name (at least 3 characters).' : ''],
        [$('#mProduct'), () => $('#mProduct').value.trim().length < 3 ? 'Describe the product or service.' : ''],
      ])) return;
      S.match = {
        name: $('#mName').value.trim(), product: $('#mProduct').value.trim(), objective: $('#mObjective').value, ctype: $('#mType').value,
        audience: $('#mAudience').value.trim(), niche: $('#mNiche').value, platform: $('#mPlatform').value, language: $('#mLang').value, budget: $('#mBudget').value,
      };
      if (B.configured && (!Account.gate({ why: 'use AI matching' }) || !(await Account.meter('ai_match')))) return;
      S.matchResults = CREATORS.map(c => scoreCreator(c, S.match)).sort((a, b) => b.score - a.score || b.c.engagement - a.c.engagement).slice(0, 6);
      $('#matchOut').innerHTML = matchResultsHtml(S.matchResults);
      icons();
      if (matchMedia('(max-width: 1024px)').matches) $('#matchOut').scrollIntoView({ behavior: 'smooth' });
    });
    $('#matchOut').addEventListener('click', e => {
      const btn = e.target.closest('#aiSummary');
      if (btn) aiRecommend(btn);
    });
  }

  async function aiRecommend(btn) {
    const out = $('#aiSummaryOut');
    const m = S.match;
    setBusy(btn, true, 'Thinking…');
    out.innerHTML = '<div class="panel ai-sum"><div class="thinking"><span class="dots"><i></i><i></i><i></i></span>Asking the AI model to review the top matches…</div></div>';
    try {
      const top = S.matchResults.slice(0, 3).map(r => `${r.c.name}: ${NICHE_LABEL[r.c.category]}, ${r.c.city}, ${Object.keys(r.c.platforms).join('/')}, languages ${r.c.languages.join('/')}, ${compact(r.c.followers)} followers, ${r.c.engagement}% engagement, from ₹${r.c.priceFrom}, score ${r.score}/100. Bio: ${r.c.bio}`).join('\n');
      await AI.chat([
        { role: 'system', content: 'You are an influencer-marketing strategist. In Markdown, write: one bold line recommending the single best creator and why, then one bullet per creator with a concrete content idea for the campaign. Max 120 words. Note that metrics are sample data. No preamble.' },
        { role: 'user', content: `Campaign: ${m.name}. Product: ${m.product}. Objective: ${m.objective}. Content: ${m.ctype}. Audience: ${m.audience || 'not specified'}.\n\nTop creators:\n${top}` },
      ], { onToken: (_, full) => { out.innerHTML = `<div class="panel ai-sum"><span class="ai-tag"><i data-lucide="bot"></i>AI-generated, may be inaccurate</span>${mdToHtml(full)}</div>`; icons(); } });
    } catch (err) {
      out.innerHTML = `<div class="panel ai-sum err"><i data-lucide="alert-circle"></i>${esc(err.message)} The rule-based ranking above still applies.</div>`;
      icons();
    } finally { setBusy(btn, false); }
  }

  /* ======================================================
     COLLABORATION REQUESTS (saved to Supabase)
     ====================================================== */
  async function openRequest(creatorId, tier = 1) {
    const c = byId[creatorId];
    if (!c || !Account.gate({ why: 'send collaboration requests' })) return;  // signed in is enough: no extra login or account-type step
    try { if (!S.myCampaigns.length) await loadCampaignData(); } catch { /* campaigns are optional here */ }
    const mine = S.myCampaigns;
    const pkg = c.packages[tier] || c.packages[1];
    const body = openModal(`
      <div class="modal-head"><div class="bk-who"><img src="${c.avatar}" alt=""><div><b>Collaboration request</b><small>to ${esc(c.name)} · ${NICHE_LABEL[c.category]}</small></div></div><button class="icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button></div>
      <p class="demo-note"><i data-lucide="info"></i>${esc(c.name)} is a sample creator, so your request is saved to your account but not delivered to a real person.</p>
      <form id="reqForm" novalidate>
        <div class="field"><label class="field-label" for="rqCamp">Campaign</label>
          <select id="rqCamp"><option value="">${mine.length ? 'Not linked to a campaign' : 'No campaigns yet (optional)'}</option>${mine.map(x => `<option value="${x.id}">${esc(x.title)}</option>`).join('')}</select></div>
        <div class="row-2">
          <div class="field"><label class="field-label" for="rqBudget">Proposed budget (₹)</label><input id="rqBudget" type="number" min="500" step="500" value="${pkg.price}" /></div>
          <div class="field"><label class="field-label" for="rqDate">Go-live by</label><input id="rqDate" type="date" min="${new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10)}" value="${new Date(Date.now() + 14 * DAY).toISOString().slice(0, 10)}" /></div>
        </div>
        <div class="field"><label class="field-label" for="rqDeliv">Deliverables</label><input id="rqDeliv" value="${esc(`${pkg.tier}: ${pkg.title}`)}" /></div>
        <div class="field"><label class="field-label" for="rqMsg">Message</label>
          <div class="prompt-wrap"><textarea id="rqMsg" rows="5" placeholder="Introduce your brand, the product and what you'd like ${esc(c.name.split(' ')[0])} to create."></textarea>
          <button type="button" class="enhance" id="rqAI"><i data-lucide="wand-2"></i>Write with AI</button></div></div>
        <p class="form-msg" id="rqErr" role="alert" hidden></p>
        <div class="modal-foot"><button type="button" class="btn soft" data-close>Cancel</button><button class="btn primary" id="rqGo"><i data-lucide="send"></i>Send request</button></div>
      </form>`);
    body.onclick = async e => {
      if (e.target.closest('[data-close]')) return closeModal();
      const ai = e.target.closest('#rqAI');
      if (ai) {
        setBusy(ai, true, 'Writing…');
        const camp = mine.find(x => x.id === $('#rqCamp').value);
        try {
          await aiIntoTextarea($('#rqMsg'), [
            { role: 'system', content: 'Write a short, friendly collaboration request from a brand to a content creator. 70-100 words, plain text, no subject line, no placeholders in brackets, no preamble.' },
            { role: 'user', content: `Brand: ${me().name}. Creator: ${c.name}, ${NICHE_LABEL[c.category]} creator known for ${c.tags.join(', ')}. ${camp ? `Campaign: ${camp.title}. ${camp.brief}` : ''} Deliverables: ${$('#rqDeliv').value}. Budget ₹${$('#rqBudget').value}. Go-live by ${$('#rqDate').value}.` },
          ]);
        } catch (err) { toast(err.message, 'err'); }
        finally { setBusy(ai, false); }
      }
    };
    $('#reqForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (!validateAll([
        [$('#rqBudget'), () => (!(+$('#rqBudget').value >= 500) ? 'Enter a budget of at least ₹500.' : '')],
        [$('#rqDate'), () => (!$('#rqDate').value ? 'Choose a date.' : '')],
        [$('#rqDeliv'), () => ($('#rqDeliv').value.trim().length < 3 ? 'List the deliverables.' : '')],
        [$('#rqMsg'), () => ($('#rqMsg').value.trim().length < 20 ? 'Write a message of at least 20 characters.' : '')],
      ])) return;
      const btn = $('#rqGo');
      setBusy(btn, true, 'Sending…');
      const payload = { creator_ref: c.id, creator_name: c.name, campaign_id: $('#rqCamp').value || null, budget: +$('#rqBudget').value,
        deliverables: $('#rqDeliv').value.trim(), go_live: $('#rqDate').value, message: $('#rqMsg').value.trim() };
      let local = false;
      try {
        try {
          await B.db.sendRequest(payload);
          S.requests = await B.db.requests();
          loadUserData().then(renderChrome);
        } catch (err) {
          if (!err.dbMissing) throw err;
          // Database not set up yet: keep the request in this browser (like the demo chat) instead of blocking the user
          local = true;
          const list = [{ ...payload, id: uid(), status: 'saved on this device', created_at: new Date().toISOString() }, ...store.get('localRequests', [])];
          store.set('localRequests', list);
          S.requests = list;
        }
        openModal(`
          <div class="success">
            <div class="success-ico"><i data-lucide="send"></i></div>
            <h2>Request saved</h2>
            <p class="muted">${local ? `Your request to ${esc(c.name)} is saved in this browser only, because the site's database isn't set up yet (no email is sent).`
              : `Your request to ${esc(c.name)} is saved to your account and you'll get a confirmation email.`} Sample creators don't receive real messages.</p>
            <div class="modal-foot center"><button class="btn primary" data-goto="#/campaigns"><i data-lucide="megaphone"></i>View requests</button></div>
          </div>`).onclick = ev => { const g = ev.target.closest('[data-goto]'); if (g) { closeModal(); location.hash = g.dataset.goto; } };
      } catch (err) {
        setBusy(btn, false);
        const m = $('#rqErr'); m.textContent = err.message; m.hidden = false;
      }
    });
  }

  /* ======================================================
     HELP, LEGAL, SAVED
     ====================================================== */
  function renderHelp(section) {
    const faqs = [
      ['Are the creators in the directory real?', 'No. The featured directory is fictional sample data used to demonstrate the product. Campaigns, applications and creator profiles created by members are real records in our database.'],
      ['How does AI Matching rank creators?', 'With a transparent rule-based score (niche, platform, budget, language, profile keywords and engagement). You can optionally ask a language model for a written recommendation.'],
      ['What does the Free plan include?', 'A monthly allowance of creator profile views, searches and AI matches, one campaign per month and up to five saved creators. Limits are shown on your dashboard and can change; see Pricing.'],
      ['How are payments handled?', 'Premium is billed through Razorpay. We never see or store card details, and Premium is switched on only after Razorpay confirms the payment to our server.'],
      ['How do I cancel Premium?', 'Go to Billing and choose Cancel subscription. You keep Premium until the end of the paid period.'],
      ['Which AI service is used?', 'Text and images come from the free Pollinations.ai service. Prompts you send to AI features are processed by that service.'],
      ['Can creators write content in Telugu?', 'Yes. The AI Content Studio can write in English, Hindi or Telugu, and can translate a draft.'],
    ];
    return `
    <section class="page-head"><div><span class="pill-badge"><i data-lucide="life-buoy"></i>Help Center</span><h1>How can we help?</h1></div></section>
    <div class="help-grid">
      <div>
        <h2 class="h-sec">Frequently asked questions</h2>
        ${faqs.map(([q, a], i) => `<details class="faq" ${i === 0 && !section ? 'open' : ''}><summary>${q}<i data-lucide="chevron-down"></i></summary><p>${a}</p></details>`).join('')}
        <h2 class="h-sec" id="stories">Success stories</h2>
        <div class="panel empty-inline"><i data-lucide="book-open"></i><p>We'll publish case studies here once real campaigns have run on the platform. We don't show invented testimonials.</p></div>
      </div>
      <div class="panel">
        <h2 class="h-sec" id="contact">Contact us</h2>
        <p class="muted">Email support from your account's email address so we can verify it's you. Never include passwords or card details.</p>
        <p class="demo-note"><i data-lucide="info"></i>A support inbox hasn't been configured for this deployment yet. The site owner can add one in <code>index.html</code>.</p>
      </div>
    </div>`;
  }

  function wireHelp(section) {
    if (section) setTimeout(() => $('#' + section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  function renderLegal(kind) {
    if (kind === 'refunds') return `
    <section class="page-head"><div><span class="pill-badge"><i data-lucide="file-text"></i>Legal</span><h1>Refund &amp; Cancellation Policy</h1><p class="muted">Draft template · have it reviewed before launch</p></div></section>
    <article class="panel prose">
      <h3>Cancelling Premium</h3><p>You can cancel any time from Billing. Your subscription will not renew, and you keep Premium until the end of the period you have paid for.</p>
      <h3>Refunds</h3><p>Payments for a billing period that has started are non-refundable, except where required by law or when you were charged in error (for example, a duplicate charge). Contact us within 7 days of the charge and we'll review it. Approved refunds go back to the original payment method through Razorpay, usually within 5–7 business days.</p>
      <h3>Failed or pending payments</h3><p>If money was deducted but Premium was not activated, Razorpay either confirms the payment (and we activate Premium) or reverses it automatically.</p>
    </article>`;
    const privacy = kind !== 'terms';
    return `
    <section class="page-head"><div><span class="pill-badge"><i data-lucide="file-text"></i>Legal</span><h1>${privacy ? 'Privacy Policy' : 'Terms of Service'}</h1><p class="muted">Draft template · have it reviewed before launch</p></div></section>
    <article class="panel prose">
      ${privacy ? `
        <h3>What we store</h3><p>Your account (name, email, account type), the profiles, campaigns, applications, requests and saved creators you create, notification preferences, plan usage counters and subscription status. Data is stored in Supabase (PostgreSQL) and protected with row-level security so other users cannot read your private records.</p>
        <h3>Passwords and payments</h3><p>Passwords are handled by Supabase Auth and never stored in plain text. Payments are processed by Razorpay; we never receive or store card numbers, CVVs or UPI PINs. We store the Razorpay subscription ID and status.</p>
        <h3>Emails</h3><p>We send account, security, billing and activity emails through Resend. You can turn off activity, usage, renewal, sign-in alert and new-message emails in Account settings; security and payment emails are always sent. Message emails never include the message text.</p>
        <h3>News and updates</h3><p>We only send announcement emails if you opt in (at sign-up or in Account settings). Each one is sent to you individually with a one-click unsubscribe link, and we stop sending to addresses that bounce or report spam.</p>
        <h3>Sign-in records</h3><p>To protect accounts and understand usage, we record each sign-in and failed sign-in attempt: the time, the email address used, whether it succeeded, the reason it failed, and the sign-in method. We never record passwords. These records are visible only to CreatorVerse AI administrators, who may export them for analysis, and are deleted after 180 days.</p>
        <h3>AI features</h3><p>Text you submit to AI features is sent to Pollinations.ai to generate a response.</p>
        <h3>Images</h3><p>Some images load from Unsplash and randomuser.me. Featured creator portraits are AI-generated.</p>`
      : `
        <h3>Sample directory</h3><p>Creators shown in the featured directory are fictional sample profiles. Requests sent to them are stored in your account but not delivered to a person.</p>
        <h3>Plans and payments</h3><p>Premium subscriptions renew automatically until cancelled and are billed by Razorpay. Prices shown may be samples until final pricing is published. Premium access starts only after the payment is confirmed.</p>
        <h3>AI output</h3><p>AI-generated text may be inaccurate. Review it before publishing.</p>
        <h3>Acceptable use</h3><p>Don't post unlawful content, impersonate others, or try to bypass plan limits or security controls.</p>`}
    </article>`;
  }

  function renderSaved() {
    if (!B.session) return `<section class="page-head"><div><h1>Saved creators</h1><p class="muted">Saving needs accounts, which aren't connected on this copy of the site.</p></div></section>
      <div class="empty-big"><div class="empty-art pink"><i data-lucide="heart"></i></div><h3>Your shortlist lives in your account</h3><a class="btn primary" href="#/explore">Browse creators</a></div>`;
    const list = [...S.saved].map(id => byId[id]).filter(Boolean);
    const limit = B.plan?.usage?.find(u => u.feature === 'saved_creator')?.limit;
    return `
    <section class="page-head"><div><h1>Saved creators</h1><p class="muted">Your shortlist${limit != null ? ` (${list.length} of ${limit} on your plan)` : ''}. Compare, request or remove.</p></div></section>
    ${list.length ? `<div class="c-grid">${list.map(creatorCard).join('')}</div>` : `
      <div class="empty-big"><div class="empty-art pink"><i data-lucide="heart"></i></div><h3>No saved creators yet</h3><p class="muted">Tap the heart on any creator to build your shortlist.</p><a class="btn primary" href="#/explore">Explore creators</a></div>`}`;
  }

  const notFound = () => `<div class="empty-big"><h3>Page not found</h3><a class="btn primary" href="#/">Go home</a></div>`;

  /* ======================================================
     ROUTER + CHROME
     ====================================================== */
  const AUTH_PAGES = new Set(['dashboard', 'messages', ...Account.AUTH_REQUIRED]);
  // Reachable without signing in (everything else is behind the entrance login)
  const PUBLIC_PAGES = new Set(['login', 'signup', 'join', 'verify', 'forgot', 'reset', 'legal', 'unsubscribe']);

  function renderUnsubscribe() {
    const ok = S.unsub === 'ok', invalid = S.unsub === 'invalid';
    return `<section class="auth-wrap narrow"><div class="auth-intro"><span class="pill-badge"><i data-lucide="mail-minus"></i>Email preferences</span>
      <h1>${ok ? 'You are unsubscribed' : invalid ? 'Link not recognised' : 'Unsubscribe'}</h1>
      <p class="muted">${ok ? 'You will no longer receive CreatorVerse AI news and campaign emails. Account and security emails (sign-in alerts, password changes, billing) are separate and still sent.'
        : invalid ? 'This unsubscribe link is invalid or was already used. You can manage all email preferences in Account settings after signing in.'
        : esc(S.unsub || 'Open the unsubscribe link from one of our emails.')}</p></div>
      <div class="head-actions"><a class="btn primary" href="#/account">Manage email preferences</a></div></section>`;
  }
  const TITLES = {
    home: 'CreatorVerse AI · Find Your Perfect Creator', explore: 'Explore Creators', match: 'AI Matching', campaigns: 'Campaigns', pricing: 'Pricing',
    join: 'Get Started', signup: 'Sign Up', login: 'Login', verify: 'Verify Email', forgot: 'Forgot Password', reset: 'Reset Password', onboarding: 'Set Up Your Profile',
    account: 'Account Settings', notifications: 'Notifications', billing: 'Billing', payment: 'Payment', admin: 'Admin',
    dashboard: 'Dashboard', messages: 'Messages', saved: 'Saved Creators', studio: 'AI Content Studio', help: 'Help Center', legal: 'Legal',
    members: 'Discover Members', u: 'Member Profile', requests: 'Collaboration Requests', connections: 'My Connections', unsubscribe: 'Unsubscribe',
  };
  let routeSeq = 0;

  async function route() {
    const seq = ++routeSeq;
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const page = parts[0] || 'home';
    const param = decodeURIComponent(parts[1] || '');
    const app = $('#app'), studio = $('#studio');

    if (B.configured) {
      // Single sign-in at the entrance: every page except the account pages needs a session.
      if (!B.session && !PUBLIC_PAGES.has(page)) {
        if (!S.next) S.next = location.hash || '#/';  // come back here after signing in
        location.replace('#/login');
        return;
      }
      if (B.session && !B.verified && !PUBLIC_PAGES.has(page)) { location.replace('#/verify'); return; }
      if (['login', 'signup', 'join'].includes(page) && B.session) { location.replace(S.next || (B.profile?.role ? '#/' : '#/onboarding')); S.next = null; return; }
      // account type is chosen once, right after the first sign-in
      if (B.session && !B.profile?.role && !B.dbMissing && !['onboarding', 'account', 'legal', 'verify', 'reset'].includes(page)) { location.replace('#/onboarding'); return; }
    } else if (page === 'dashboard' || page === 'messages') {
      location.replace('#/login');  // shows the setup-required screen
      return;
    }

    closeMenus();
    if (S.match && page !== 'match' && page !== 'creator') { S.match = null; S.matchResults = null; }
    $$('[data-route]').forEach(a => {
      const on = a.dataset.route === page;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    if (page === 'studio') {
      app.hidden = true; studio.hidden = false;
      Studio.show(param);
    } else {
      // Creator profiles are metered per user (counted once per profile per session)
      let profileLock = null;
      if (page === 'creator' && byId[param] && B.configured && !S.viewed.has(param)) {
        if (B.session && B.verified) {
          try { await B.consume('profile_view'); S.viewed.add(param); persist(); }
          catch (err) { if (err instanceof QuotaError) profileLock = err; else console.warn('profile view not counted:', err.message); }  // only a real plan limit locks a profile
        }
        if (seq !== routeSeq) return;  // user navigated away meanwhile
      }
      studio.hidden = true; app.hidden = false;
      const DB_PAGES = ['dashboard', 'onboarding', 'account', 'notifications', 'billing', 'admin', 'saved'];
      const STATUS_PAGES = ['dashboard', 'onboarding', 'saved', 'billing'];
      const acc = B.session && B.dbMissing && DB_PAGES.includes(page) ? [Account.dbSetupPending, () => {}]
        : B.session && B.accountStatus !== 'active' && STATUS_PAGES.includes(page) ? [Account.accountStatusScreen, () => {}]
        : Account.views[page] || Social.views[page];
      const views = {
        home: renderHome, explore: renderExplore, campaigns: renderCampaigns, messages: () => renderMessages(param),
        dashboard: renderDashboard, saved: renderSaved, match: renderMatch, help: () => renderHelp(param), legal: () => renderLegal(param),
        creator: () => (profileLock ? renderProfileLocked(param) : renderProfile(param)),
        unsubscribe: renderUnsubscribe,
      };
      const html = acc ? acc[0](param) : (views[page] || notFound)();
      const banner = !B.configured && !B.initializing && page !== 'home' ? `<p class="setup-banner"><i data-lucide="plug-zap"></i>Accounts, saving and payments aren't connected on this copy of the site (setup required). Browsing works.</p>` : '';
      app.innerHTML = page === 'home' ? html : `<div class="container page-body">${banner}${html}</div>`;
      app.classList.toggle('is-home', page === 'home');
      app.classList.remove('enter'); void app.offsetWidth; app.classList.add('enter');
      if (acc) acc[1](param);
      if (page === 'home') wireHome();
      if (page === 'explore') wireExplore();
      if (page === 'creator' && !profileLock) wireProfile(param);
      if (page === 'creator' && profileLock instanceof QuotaError) Account.upgradeDialog(profileLock);
      if (page === 'campaigns') wireCampaigns();
      if (page === 'messages') { wireMessages(param); Social.wireInbox(param.startsWith('m-') ? param.slice(2) : null); if (param.startsWith('m-')) Social.wireConversation(param.slice(2)); }
      if (page === 'dashboard') wireDashboard();
      if (page === 'match') wireMatch();
      if (page === 'help') wireHelp(param);
      if (page !== 'messages') Social.stopLive();
    }
    const creatorName = page === 'creator' && byId[param]?.name;
    document.title = page === 'home' ? TITLES.home : `${creatorName || TITLES[page] || 'Not found'} · CreatorVerse AI`;
    renderChrome();
    icons();
    B.touchActivity();
    if (page !== 'messages' || !param) window.scrollTo({ top: 0 });
  }

  function renderChrome() {
    const signed = !!B.session;
    document.body.classList.toggle('gated', B.configured && !signed);
    $('#guestActions').hidden = signed;
    $('#userActions').hidden = !signed;
    const unread = S.notifs.filter(n => !n.read_at).length;
    if (signed) Social.refreshUnread(); else $('#msgBadge').hidden = true;
    $('#savedCount').hidden = !S.saved.size; $('#savedCount').textContent = S.saved.size;
    $('.saved-link').hidden = !signed;
    $('#notifDot').hidden = !unread;
    if (signed) {
      const r = role(), premium = B.tier === 'premium';
      $('#meChip').innerHTML = `${meAvatar(30)}<span>${esc(me().name)}</span><i data-lucide="chevron-down"></i>`;
      $('#meMenu').innerHTML = `
        <div class="mm-who"><b>${esc(me().name)}</b><small>${r === 'brand' ? 'Brand account' : r === 'creator' ? 'Creator account' : 'Account'} · ${premium ? 'Premium' : 'Free plan'}</small></div>
        <a href="#/dashboard"><i data-lucide="layout-dashboard"></i>Dashboard</a>
        <a href="#/u/me"><i data-lucide="user-round"></i>My profile</a>
        <a href="#/members"><i data-lucide="users"></i>Discover members</a>
        <a href="#/requests"><i data-lucide="handshake"></i>Collaboration requests</a>
        <a href="#/connections"><i data-lucide="users-round"></i>My connections</a>
        <a href="#/messages"><i data-lucide="message-circle"></i>Messages</a>
        <a href="#/notifications"><i data-lucide="bell"></i>Notifications</a>
        <a href="#/saved"><i data-lucide="heart"></i>Saved creators</a>
        <a href="#/account"><i data-lucide="settings"></i>Account settings</a>
        <a href="#/billing"><i data-lucide="credit-card"></i>Plan &amp; billing</a>
        ${premium ? '' : '<a href="#/pricing" class="mm-upgrade"><i data-lucide="crown"></i>Upgrade to Premium</a>'}
        ${B.isAdmin ? '<a href="#/admin"><i data-lucide="shield"></i>Admin</a>' : ''}
        <button data-signout><i data-lucide="log-out"></i>Sign out</button>`;
      $('#notifPop').innerHTML = `
        <div class="np-head"><b>Notifications</b><button class="link" id="markRead">Mark all read</button></div>
        ${S.notifs.length ? S.notifs.map(Account.notifItem).join('') : '<p class="muted sm-text" style="padding:10px">No notifications yet.</p>'}
        <a class="np-all" href="#/notifications">View all</a>`;
    }
    $('#mobileAuth').innerHTML = signed
      ? `<a href="#/dashboard"><i data-lucide="layout-dashboard"></i>Dashboard</a><a href="#/members"><i data-lucide="users"></i>Discover members</a><a href="#/requests"><i data-lucide="handshake"></i>Requests</a><a href="#/connections"><i data-lucide="users-round"></i>Connections</a><a href="#/messages"><i data-lucide="message-circle"></i>Messages</a><a href="#/notifications"><i data-lucide="bell"></i>Notifications</a><a href="#/account"><i data-lucide="settings"></i>Account</a><a href="#/billing"><i data-lucide="credit-card"></i>Billing</a><button data-signout><i data-lucide="log-out"></i>Sign out (${esc(me().name)})</button>`
      : '';  // signed out = the entrance login page itself; no extra login/sign-up buttons
    icons();
  }

  function closeMenus() {
    $('#mobileMenu').hidden = true;
    $('#burger').setAttribute('aria-expanded', 'false');
    $('#meMenu').hidden = true;
    $('#meChip').setAttribute('aria-expanded', 'false');
    $('#notifPop').hidden = true;
  }

  function openSearch() {
    const body = openModal(`
      <div class="modal-head"><h2><i data-lucide="search"></i>Search creators</h2><button class="icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button></div>
      <form id="qsForm" role="search"><input id="qsInput" placeholder="Name, niche, city, language…" aria-label="Search creators" autocomplete="off" /></form>
      <p class="muted sm-text">Press Enter to search the marketplace${B.configured ? ' (counts as one search on your plan)' : ''}.</p>`);
    $('#qsInput').focus();
    $('#qsForm').addEventListener('submit', async e => {
      e.preventDefault();
      const q = $('#qsInput').value.trim();
      closeModal();
      if (q && !(await meterSearch())) return;
      S.explore = { ...freshExplore(), q };
      if (location.hash === '#/explore') route(); else location.hash = '#/explore';
    });
    body.onclick = e => { if (e.target.closest('[data-close]')) closeModal(); };
  }

  // Searches are counted on the server; guests are asked to sign in. Without a backend (demo) they're free.
  async function meterSearch() {
    if (!B.configured) return true;
    if (!Account.gate({ why: 'search creators' })) return false;
    return Account.meter('search');
  }

  async function toggleSave(id, btn) {
    const c = byId[id];
    if (!Account.gate({ why: 'save creators' })) return;
    const wasSaved = S.saved.has(id);
    try {
      if (wasSaved) { await B.db.unsave(id); S.saved.delete(id); toast(`Removed ${c.name} from saved`); }
      else { await B.db.save(id); S.saved.add(id); toast(`Saved ${c.name} to your shortlist`); }
    } catch (err) {
      if (err instanceof QuotaError) return Account.upgradeDialog(err);
      return toast(err.message, 'err');
    }
    $$(`[data-save="${id}"]`).forEach(b => {
      b.classList.toggle('on', S.saved.has(id));
      const span = b.querySelector('span'); if (span) span.textContent = S.saved.has(id) ? 'Saved' : 'Save';
    });
    btn?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 300 });
    B.refresh();
    renderChrome();
    if (location.hash.startsWith('#/saved')) route();
  }

  async function signOut() {
    closeModal();
    Social.stopGlobalLive(); Social.stopLive();
    await B.auth.signOut();
    Object.assign(S, { saved: new Set(), notifs: [], myCampaigns: [], myApplications: [], requests: [], viewed: new Set() });
    try { sessionStorage.removeItem('cverse:viewed'); } catch { /* blocked */ }
    toast('Signed out');
    if (location.hash === '#/' || location.hash === '') route(); else location.hash = '#/';
  }

  /* ---------- Global delegated clicks ---------- */
  function onClick(e) {
    const t = e.target;
    if (t.closest('[data-connect],[data-conn-action],[data-dm],[data-collab]')) { Social.handleClick(e); return; }
    const nx = t.closest('[data-next]');
    if (nx) S.next = nx.dataset.next;  // return here after logging in
    const pw = t.closest('[data-pw]');
    if (pw) {
      const input = $('#' + pw.dataset.pw);
      input.type = input.type === 'password' ? 'text' : 'password';
      pw.setAttribute('aria-label', input.type === 'password' ? 'Show password' : 'Hide password');
      pw.innerHTML = `<i data-lucide="${input.type === 'password' ? 'eye' : 'eye-off'}"></i>`;
      return icons();
    }
    const save = t.closest('[data-save]');
    if (save) { e.preventDefault(); e.stopPropagation(); return toggleSave(save.dataset.save, save); }
    const req = t.closest('[data-request]');
    if (req) return openRequest(req.dataset.request, req.dataset.tier ? +req.dataset.tier : 1);
    const msg = t.closest('[data-message]');
    if (msg) {
      if (!Account.gate({ why: 'use the demo chat' })) return;
      thread('brand', msg.dataset.message); persist(); location.hash = '#/messages/b-' + msg.dataset.message; return;
    }
    const share = t.closest('[data-share]');
    if (share) return copyText(location.href, 'Profile link copied');
    const fit = t.closest('[data-fit]');
    if (fit) return openFitCheck(fit.dataset.fit);
    const zoom = t.closest('[data-zoom]');
    if (zoom) return openLightbox(zoom.dataset.zoom, zoom.dataset.cap);
    const camp = t.closest('[data-campaign]');
    if (camp && !$('#modal').open) return openCampaign(camp.dataset.campaign);
    if (t.closest('[data-new-campaign]')) return openNewCampaign();
    if (t.closest('[data-clear-filters]')) { S.explore = freshExplore(); return route(); }
    if (t.closest('[data-signout]')) return signOut();
    const lockBtn = t.closest('[data-premium-lock]');
    if (lockBtn) { e.preventDefault(); return Account.gate({ why: 'use advanced filters' }) && Account.upgradeDialog(null); }
    const social = t.closest('[data-social]');
    if (social) return toast(`CreatorVerse AI on ${social.dataset.social}: official account coming soon`);
    const card = t.closest('[data-open-creator]');
    if (card) { location.hash = '#/creator/' + card.dataset.openCreator; return; }

    // Header menus
    if (t.closest('#searchBtn')) return openSearch();
    if (t.closest('#burger')) {
      const open = $('#mobileMenu').hidden;
      closeMenus();
      $('#mobileMenu').hidden = !open;
      $('#burger').setAttribute('aria-expanded', String(open));
      return;
    }
    if (t.closest('#meChip')) {
      const open = $('#meMenu').hidden;
      closeMenus();
      $('#meMenu').hidden = !open;
      $('#meChip').setAttribute('aria-expanded', String(open));
      return;
    }
    if (t.closest('#notifBtn')) { const open = $('#notifPop').hidden; closeMenus(); $('#notifPop').hidden = !open; return; }
    if (t.closest('#markRead')) {
      const ids = S.notifs.filter(n => !n.read_at).map(n => n.id);
      if (ids.length) B.db.markRead(ids).then(loadUserData).then(renderChrome).catch(err => toast(err.message, 'err'));
      return;
    }
    if (!t.closest('#notifPop, #meMenu, #mobileMenu')) closeMenus();
  }

  // After an email link or Google redirect, send the user to the right screen
  async function handleAuthResult() {
    const r = B.urlResult;
    if (!r) return false;
    B.clearUrlResult();
    if (r.type === 'unsubscribe') {
      try { S.unsub = (await B.unsubscribe(r.token)) ? 'ok' : 'invalid'; } catch (err) { S.unsub = err.message; }
      if (location.hash === '#/unsubscribe') route(); else location.replace('#/unsubscribe');
      return true;
    }
    if (r.error) { toast(r.error, 'err'); location.replace('#/login'); return true; }
    if (r.type === 'recovery') { location.replace('#/reset'); return true; }
    if (r.type === 'email_change') { toast('Email address updated'); location.replace('#/account'); return true; }
    if (!B.session) return false;
    const intended = sessionStorage.getItem('cverse:intendedRole');
    if (!B.profile?.role && (intended === 'brand' || intended === 'creator')) {
      try { await B.db.updateProfile({ role: intended }); sessionStorage.removeItem('cverse:intendedRole'); } catch { /* chosen on onboarding instead */ }
    }
    const viaGoogle = (B.user?.app_metadata?.providers || []).includes('google');
    toast(r.type === 'code' ? (viaGoogle ? 'Signed in with Google' : 'Signed in. Welcome to CreatorVerse AI!') : 'Email verified. Welcome to CreatorVerse AI!');
    location.replace(S.next || (B.profile?.role ? '#/dashboard' : '#/onboarding'));
    return true;
  }

  async function init() {
    // Fallback image if a remote photo fails
    document.addEventListener('error', e => {
      const img = e.target;
      if (img.tagName === 'IMG' && !img.dataset.fb && !img.src.startsWith('blob:') && !img.src.includes('/api/image')) {
        img.dataset.fb = 1;
        img.src = `https://picsum.photos/seed/${encodeURIComponent(img.alt || img.src.slice(-12))}/800/600`;
      }
    }, true);

    document.addEventListener('click', onClick);
    $('#modal').addEventListener('click', e => { if (e.target === $('#modal')) closeModal(); });
    $('#lightbox').addEventListener('click', e => { if (e.target === $('#lightbox') || e.target.closest('.lb-close')) $('#lightbox').close(); });
    $('#year').textContent = new Date().getFullYear();

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeMenus();
      // Creator and campaign cards are focusable: Enter opens them
      const card = e.target.closest?.('[data-open-creator]');
      if (card && e.key === 'Enter' && e.target === card) location.hash = '#/creator/' + card.dataset.openCreator;
      const camp = e.target.closest?.('[data-campaign]');
      if (camp && e.key === 'Enter' && e.target === camp) openCampaign(camp.dataset.campaign);
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const form = document.activeElement?.closest('form');
        if (form && !form.closest('#settingsDlg')) { e.preventDefault(); form.requestSubmit(); }
      }
    });

    Studio.init();
    // Account pages render immediately; everything else waits for the session check (entrance login).
    const first = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'home';
    const publicFirst = PUBLIC_PAGES.has(first) && !location.search;
    if (publicFirst) route(); else $('#app').innerHTML = '<div class="container page-body"><div class="skeleton" style="height:320px"></div></div>';

    try {
      await Promise.race([B.init(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))]);
    } catch (err) { console.warn('Backend unavailable:', err.message); }
    await loadUserData();
    B.on(async () => { await loadUserData(); renderChrome(); if (B.session) Social.startGlobalLive(); else Social.stopGlobalLive(); });
    if (B.session) Social.startGlobalLive();
    window.addEventListener('hashchange', route);
    if (await handleAuthResult()) return;
    // Re-render now that the configuration and session are known (this applies the entrance login).
    route();
  }

  return {
    init, me, route,
    refreshChrome: () => loadUserData().then(renderChrome),
    takeNext: () => { const n = S.next; S.next = null; return n; },
    setNext: h => { S.next = h; },
  };
})();

App.init();
