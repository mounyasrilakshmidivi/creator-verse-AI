/* ================= AI Studio: tools for creators ================= */
const Studio = (() => {
  const PLATFORMS = {
    instagram: { name: 'Instagram', icon: 'instagram', color: 'linear-gradient(135deg,#f58529,#dd2a7b,#8134af)', limit: 2200, ratio: '4:5',
      guide: 'Instagram caption. Strong first-line hook (it shows before "more"). Short lines with line breaks, scannable. Hashtags grouped at the very end (8-12 relevant ones).' },
    linkedin: { name: 'LinkedIn', icon: 'linkedin', color: '#0a66c2', limit: 3000, ratio: '1:1',
      guide: 'LinkedIn post. Open with a one-line hook, then short 1-2 sentence paragraphs with white space. Share an insight or lesson, professional but human. End with a question to drive comments. 3-5 hashtags at the end.' },
    x: { name: 'X / Twitter', icon: 'twitter', color: '#1d1d1f', limit: 280, ratio: '16:9',
      guide: 'Single tweet. MUST be under 270 characters total including hashtags. Punchy, no fluff. Max 2 hashtags.' },
    facebook: { name: 'Facebook', icon: 'facebook', color: '#1877f2', limit: 2000, ratio: '1:1',
      guide: 'Facebook post. Conversational and community-focused, invite reactions and shares. 1-3 hashtags max.' },
    youtube: { name: 'YouTube', icon: 'youtube', color: '#ff0033', limit: 5000, ratio: '16:9',
      guide: 'YouTube video package. First line: "Title: ..." (under 70 chars, curiosity-driven). Then a blank line and the description: hook in first 2 lines, what viewers will learn, placeholder timestamps (00:00 Intro etc.), and 3 hashtags at the end.' },
    threads: { name: 'Threads', icon: 'at-sign', color: '#2b2b33', limit: 500, ratio: '1:1',
      guide: 'Threads post. Casual, opinionated, under 480 characters. At most 1 hashtag.' },
    blog: { name: 'Blog', icon: 'file-text', color: 'linear-gradient(135deg,#7c3aed,#c026d3)', limit: 0, ratio: '16:9', md: true,
      guide: 'Blog article in Markdown. Start with "# Title", a 2-sentence intro, then 3-5 sections with "##" headings, bullet points where useful, and a conclusion with a call to action. No hashtags unless asked.' },
    email: { name: 'Newsletter', icon: 'mail', color: 'linear-gradient(135deg,#ea580c,#f59e0b)', limit: 0, ratio: '16:9', md: true,
      guide: 'Email newsletter in Markdown. First line "**Subject:** ..." and "**Preview:** ...", then a friendly greeting, the body with short paragraphs, a clear CTA, and a sign-off. No hashtags.' },
  };
  const LENGTHS = { short: 'Keep it short and tight.', medium: 'Medium length.', long: 'Make it long and detailed, but every line must earn its place.' };

  const STYLES = [
    { id: 'none', name: 'Auto', bg: 'linear-gradient(135deg,#334155,#64748b)', suffix: '' },
    { id: 'photo', name: 'Photoreal', bg: 'linear-gradient(135deg,#78350f,#d97706 60%,#fcd34d)', suffix: 'ultra realistic photograph, 50mm lens, natural lighting, sharp focus, high detail' },
    { id: 'cinema', name: 'Cinematic', bg: 'linear-gradient(135deg,#0f172a,#0e7490 55%,#f97316)', suffix: 'cinematic film still, dramatic lighting, anamorphic, color graded, moody atmosphere' },
    { id: 'anime', name: 'Anime', bg: 'linear-gradient(135deg,#f472b6,#a78bfa 55%,#7dd3fc)', suffix: 'anime illustration, studio ghibli inspired, vibrant colors, detailed background' },
    { id: '3d', name: '3D Render', bg: 'linear-gradient(135deg,#6366f1,#ec4899 60%,#fde68a)', suffix: '3D render, octane, soft studio lighting, glossy materials, pixar style' },
    { id: 'water', name: 'Watercolor', bg: 'linear-gradient(135deg,#bae6fd,#fbcfe8 50%,#fef9c3)', suffix: 'delicate watercolor painting, soft washes, paper texture, pastel palette' },
    { id: 'cyber', name: 'Cyberpunk', bg: 'linear-gradient(135deg,#1e1b4b,#c026d3 55%,#22d3ee)', suffix: 'cyberpunk, neon lights, rainy night city, futuristic, synthwave colors' },
    { id: 'flat', name: 'Minimal', bg: 'linear-gradient(135deg,#fef3c7,#fca5a5 55%,#93c5fd)', suffix: 'minimal flat vector illustration, clean shapes, limited color palette, modern design' },
    { id: 'oil', name: 'Oil Paint', bg: 'linear-gradient(135deg,#422006,#a16207 55%,#65a30d)', suffix: 'classical oil painting, visible brush strokes, rich texture, museum quality' },
  ];
  const RATIOS = { '1:1': [1024, 1024], '4:5': [896, 1120], '16:9': [1280, 720], '9:16': [720, 1280], '3:2': [1152, 768] };

  const state = {
    platform: 'instagram',
    postCount: 1,
    style: 'none',
    ratio: '1:1',
    imgCount: 2,
    planPlatforms: new Set(['instagram', 'youtube']),
    libFilter: 'all',
    library: store.get('library', []),
    brand: store.get('brand', {}),
  };

  const goTab = tab => { location.hash = '#/studio/' + tab; };

  /* ---------- Library ---------- */
  function addToLibrary(item) {
    const entry = { id: uid(), ts: Date.now(), ...item };
    state.library.unshift(entry);
    state.library = state.library.slice(0, 300);
    store.set('library', state.library);
    renderLibCount();
    return entry;
  }
  function updateLibrary(id, patch) {
    const it = state.library.find(i => i.id === id);
    if (it) { Object.assign(it, patch); store.set('library', state.library); }
  }
  function removeFromLibrary(id) {
    state.library = state.library.filter(i => i.id !== id);
    store.set('library', state.library);
    renderLibCount();
  }
  const renderLibCount = () => { $('#libCount').textContent = state.library.length; };

  async function downloadImage(url, name = 'creatorverse-image') {
    try {
      const blob = await (await fetch(url)).blob();
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name + '.jpg' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Image downloaded');
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  }

  function brandContext() {
    const b = state.brand;
    const parts = [];
    if (b.name) parts.push(`Brand/creator name: ${b.name}.`);
    if (b.about) parts.push(`About: ${b.about}.`);
    if (b.voice) parts.push(`Brand voice: ${b.voice}.`);
    if (b.tags) parts.push(`Always include these hashtags when hashtags are used: ${b.tags}.`);
    return parts.length ? '\nBrand context:\n' + parts.join('\n') : '';
  }

  function segBind(sel, onChange) {
    $(sel).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $$(sel + ' button').forEach(x => x.classList.toggle('on', x === b));
      onChange(b.dataset.v);
    });
  }

  /* ======================================================
     POST WRITER
     ====================================================== */
  function renderPlatforms() {
    $('#platformPicker').innerHTML = Object.entries(PLATFORMS).map(([id, p]) => `
      <button type="button" class="platform ${id === state.platform ? 'on' : ''}" data-id="${id}">
        <span class="p-ico" style="background:${p.color}"><i data-lucide="${p.icon}"></i></span>${p.name.split(' ')[0]}
      </button>`).join('');
  }

  function postSystemPrompt(p) {
    return `You are a world-class social media copywriter and content strategist.
Write ready-to-publish content. Output ONLY the content itself: no preamble like "Here is", no explanations, no surrounding quotes.
Format: ${p.guide}${brandContext()}`;
  }

  const CONTENT_TYPES = {
    caption: 'Write a social media caption/post.',
    script: 'Write a short-form video script with labelled sections: Hook (first 3 seconds), Scenes (numbered, with on-screen text and voiceover), and Closing CTA. Ignore the platform character format where it conflicts.',
    product: 'Write a product description: a one-line headline, a short benefit-led paragraph and 3-5 feature bullets.',
    ad: 'Write advertisement copy: 3 headline options (max 40 chars each), 2 primary-text options (max 125 chars each) and a CTA button label.',
    hashtags: 'Output only 20 relevant hashtags grouped as broad, niche and branded. No other text.',
  };

  function postUserPrompt({ topic, tone, length, audience, emoji, tags, cta, variant, ctype = 'caption', lang = 'English', objective }) {
    const p = PLATFORMS[state.platform];
    return [
      CONTENT_TYPES[ctype] || CONTENT_TYPES.caption,
      `Topic: ${topic}`,
      objective && `Campaign objective: ${objective}.`,
      lang !== 'English' && `Write the entire output in ${lang} (native script), keeping hashtags readable.`,
      `Tone: ${tone}.`,
      LENGTHS[length],
      audience && `Target audience: ${audience}.`,
      emoji ? 'Use emojis tastefully.' : 'Do not use any emojis.',
      !p.md && (tags ? 'Include relevant hashtags.' : 'Do not include any hashtags.'),
      cta ? 'End with a clear call to action.' : 'No explicit call to action.',
      variant > 1 && `This is alternative version #${variant}: use a clearly different hook and angle from a typical version.`,
    ].filter(Boolean).join('\n');
  }

  function formatPost(text, md) {
    if (md) return mdToHtml(text);
    // social posts are plain text: drop stray markdown emphasis the model sometimes adds
    return esc(text.replace(/\*{1,2}([^*\n]+)\*{1,2}/g, '$1')).replace(/(^|\s)(#[\p{L}\p{N}_]+)/gu, '$1<span class="hashtag">$2</span>');
  }

  function postCard(platformId) {
    const p = PLATFORMS[platformId];
    const name = state.brand.name || App.me().name;
    const card = document.createElement('article');
    card.className = 'post-card';
    card.innerHTML = `
      <div class="pc-head">
        <div class="avatar">${esc(name[0].toUpperCase())}</div>
        <div class="pc-who"><b>${esc(name)}</b><small>Just now · Draft</small></div>
        <span class="pc-tag" style="background:${p.color}"><i data-lucide="${p.icon}"></i>${p.name}</span>
      </div>
      <div class="pc-body ${p.md ? 'md' : ''}"></div>
      <div class="pc-foot" hidden>
        ${p.limit ? `<div class="meter"><div class="meter-bar"><i></i></div><span class="count"></span></div>` : `<div class="meter"><span class="count"></span></div>`}
        <div class="pc-actions">
          <button class="btn soft" data-act="copy"><i data-lucide="copy"></i>Copy</button>
          <button class="btn soft" data-act="visual"><i data-lucide="image-plus"></i>Visual</button>
          <button class="btn soft" data-act="redo"><i data-lucide="refresh-cw"></i>Redo</button>
        </div>
      </div>
      <div class="pc-foot tweaks" hidden>
        <span class="fmt" style="margin-right:4px">Refine:</span>
        <div class="chips" style="margin:0">
          <button class="chip" data-tweak="Make it shorter and tighter.">Shorter</button>
          <button class="chip" data-tweak="Make it punchier with a stronger hook.">Punchier</button>
          <button class="chip" data-tweak="Make it more professional.">Professional</button>
          <button class="chip" data-tweak="Make it more fun and playful.">Fun</button>
          <button class="chip" data-tweak="Translate it to Hindi, keeping the same format.">Hindi</button>
          <button class="chip" data-tweak="Translate it to Telugu, keeping the same format.">Telugu</button>
        </div>
      </div>`;
    icons();
    return card;
  }

  const thinkingHTML = `<div class="thinking"><span class="dots"><i></i><i></i><i></i></span><span class="think-label">Warming up the muse…</span></div>`;

  async function streamInto(card, platformId, messages) {
    const p = PLATFORMS[platformId];
    const body = $('.pc-body', card);
    $$('.pc-foot', card).forEach(f => { f.hidden = true; });
    body.innerHTML = thinkingHTML;
    let raf = 0, latest = '';
    const paint = () => { raf = 0; body.innerHTML = formatPost(latest, p.md) + '<span class="caret"></span>'; };
    const text = await AI.chat(messages, {
      onThinking: () => { const l = $('.think-label', body); if (l) l.textContent = 'Thinking through angles…'; },
      onToken: (_, full) => { latest = full; if (!raf) raf = requestAnimationFrame(paint); },
    });
    cancelAnimationFrame(raf);
    const clean = text.replace(/^["“]|["”]$/g, '').trim();
    if (!clean) throw new Error('Empty response');
    body.innerHTML = formatPost(clean, p.md);
    card.dataset.text = clean;
    updateMeter(card, platformId, clean);
    $$('.pc-foot', card).forEach(f => { f.hidden = false; });
    return clean;
  }

  function updateMeter(card, platformId, text) {
    const p = PLATFORMS[platformId];
    const len = [...text].length;
    const meter = $('.meter', card);
    if (p.limit) {
      $('.meter-bar i', card).style.width = Math.min(100, (len / p.limit) * 100) + '%';
      meter.classList.toggle('over', len > p.limit);
      $('.count', card).textContent = `${len} / ${p.limit}`;
    } else {
      const words = text.split(/\s+/).filter(Boolean).length;
      $('.count', card).textContent = `${words} words · ${Math.max(1, Math.round(words / 220))} min read`;
    }
  }

  async function generatePosts(opts) {
    const out = $('#postOutput');
    const btn = $('#postGo');
    setBusy(btn, true, 'Writing…');
    out.innerHTML = '';
    const platformId = state.platform;
    const sys = postSystemPrompt(PLATFORMS[platformId]);
    try {
      for (let v = 1; v <= state.postCount; v++) {
        const card = postCard(platformId);
        out.append(card);
        const messages = [{ role: 'system', content: sys }, { role: 'user', content: postUserPrompt({ ...opts, variant: v }) }];
        try {
          const text = await streamInto(card, platformId, messages);
          const entry = addToLibrary({ type: 'post', platform: platformId, text, topic: opts.topic });
          wirePostCard(card, platformId, messages, entry.id);
        } catch (err) {
          $('.pc-body', card).innerHTML = `<span class="muted">Couldn't generate this one. ${esc(err.message)}</span>`;
          wirePostCard(card, platformId, messages, null);
          $$('.pc-foot', card)[0].hidden = false;
        }
      }
    } finally {
      setBusy(btn, false);
    }
  }

  function wirePostCard(card, platformId, baseMessages, libId) {
    card.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      const tweak = e.target.closest('[data-tweak]')?.dataset.tweak;
      const text = card.dataset.text || '';
      if (act === 'copy') return copyText(text);
      if (act === 'visual') return makeVisualFromPost(text, platformId);
      if (act === 'redo' || tweak) {
        const messages = tweak
          ? [...baseMessages, { role: 'assistant', content: text }, { role: 'user', content: tweak + ' Output only the revised content.' }]
          : baseMessages;
        try {
          const newText = await streamInto(card, platformId, messages);
          if (libId) updateLibrary(libId, { text: newText });
          else libId = addToLibrary({ type: 'post', platform: platformId, text: newText }).id;
        } catch (err) {
          toast(err.message, 'err');
          $('.pc-body', card).innerHTML = formatPost(text, PLATFORMS[platformId].md);
          $$('.pc-foot', card).forEach(f => { f.hidden = false; });
        }
      }
    });
  }

  async function makeVisualFromPost(text, platformId) {
    goTab('images');
    selectRatio(PLATFORMS[platformId].ratio);
    const ta = $('#imgPrompt');
    const genBtn = $('#imgGo');
    ta.value = '';
    ta.placeholder = 'Reading your post and imagining a visual…';
    setBusy(genBtn, true, 'Writing image prompt…');
    try {
      const prompt = await AI.chat([
        { role: 'system', content: 'You turn social media posts into a single image-generation prompt. Output ONLY the prompt, max 60 words, describing subject, setting, composition, lighting and mood. No text, letters or logos in the image.' },
        { role: 'user', content: text.slice(0, 2000) },
      ], { onToken: (_, full) => { ta.value = full; } });
      ta.value = prompt.replace(/^["“]|["”]$/g, '');
      setBusy(genBtn, false);
      generateImages();
    } catch (err) {
      setBusy(genBtn, false);
      toast('Could not create a visual prompt. ' + err.message, 'err');
    } finally {
      ta.placeholder = 'e.g. A cozy coffee shop on a rainy evening, warm lights, people reading';
    }
  }

  /* ======================================================
     IMAGE STUDIO
     ====================================================== */
  function renderStyles() {
    $('#stylePicker').innerHTML = STYLES.map(s =>
      `<button type="button" class="style ${s.id === state.style ? 'on' : ''}" data-id="${s.id}" style="background:${s.bg}">${s.name}</button>`).join('');
    $('#ratioPicker').innerHTML = Object.entries(RATIOS).map(([r, [w, h]]) => {
      const k = 22 / Math.max(w, h);
      return `<button type="button" class="ratio ${r === state.ratio ? 'on' : ''}" data-r="${r}"><i style="width:${Math.round(w * k)}px;height:${Math.round(h * k)}px"></i>${r}</button>`;
    }).join('');
  }
  function selectRatio(r) {
    state.ratio = r;
    $$('.ratio').forEach(x => x.classList.toggle('on', x.dataset.r === r));
  }

  async function enhancePrompt() {
    const ta = $('#imgPrompt');
    const idea = ta.value.trim();
    if (!idea) { ta.focus(); return toast('Type a short idea first', 'err'); }
    const btn = $('#enhanceBtn');
    setBusy(btn, true, 'Enhancing…');
    try {
      ta.value = '';
      const text = await AI.chat([
        { role: 'system', content: 'You are an expert prompt engineer for AI image generators. Rewrite the user idea into one vivid, detailed prompt (max 70 words): subject, setting, composition, lighting, color palette, mood, camera or art details. Output ONLY the prompt.' },
        { role: 'user', content: idea },
      ], { onToken: (_, full) => { ta.value = full; } });
      ta.value = text.replace(/^["“]|["”]$/g, '');
      toast('Prompt enhanced');
    } catch (err) {
      ta.value = idea;
      toast(err.message, 'err');
    } finally {
      setBusy(btn, false);
    }
  }

  async function generateImages() {
    const raw = $('#imgPrompt').value.trim();
    if (!raw) return $('#imgPrompt').focus();
    const style = STYLES.find(s => s.id === state.style);
    const prompt = style.suffix ? `${raw}, ${style.suffix}` : raw;
    const [width, height] = RATIOS[state.ratio];
    const seedIn = $('#imgSeed').value;
    const btn = $('#imgGo');
    setBusy(btn, true, 'Rendering…');

    const out = $('#imgOutput');
    $('.empty-state', out)?.remove();
    const batch = document.createElement('div');
    batch.className = 'img-batch';
    batch.innerHTML = `
      <div class="batch-head"><i data-lucide="sparkles"></i><b title="${esc(raw)}">${esc(raw)}</b><span class="fmt">· ${style.name} · ${state.ratio}</span></div>
      <div class="img-grid ${state.imgCount === 1 ? 'one' : ''}"></div>`;
    out.prepend(batch);
    const grid = $('.img-grid', batch);

    const jobs = Array.from({ length: state.imgCount }, (_, i) => {
      const seed = seedIn !== '' ? +seedIn + i : Math.floor(Math.random() * 1e9);
      const url = AI.imageUrl(prompt, { width, height, seed });
      const tile = document.createElement('div');
      tile.className = 'img-tile';
      tile.style.aspectRatio = `${width} / ${height}`;
      tile.innerHTML = `
        <div class="shimmer"><i data-lucide="palette"></i><span>Painting pixels…</span></div>
        <img alt="${esc(raw)}" />
        <div class="tile-actions">
          <button class="icon-btn" data-act="zoom" title="View"><i data-lucide="maximize-2"></i></button>
          <button class="icon-btn" data-act="copy" title="Copy prompt"><i data-lucide="copy"></i></button>
          <button class="icon-btn" data-act="download" title="Download"><i data-lucide="download"></i></button>
        </div>`;
      grid.append(tile);
      return { tile, url, seed };
    });
    icons();
    batch.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Load one at a time: the free tier queues requests per user
    let ok = 0, limitHit = false;
    for (const { tile, url, seed } of jobs) {
      const img = $('img', tile);
      try {
        if (limitHit) throw Object.assign(new Error(''), { code: 'limit' });
        img.src = await AI.loadImage(url);
        await img.decode().catch(() => {});
        img.classList.add('loaded');
        $('.shimmer', tile).remove();
        ok++;
        addToLibrary({ type: 'image', url, prompt: raw, style: style.name, ratio: state.ratio, seed });
        tile.addEventListener('click', e => {
          const act = e.target.closest('[data-act]')?.dataset.act;
          if (act === 'copy') copyText(raw);
          else if (act === 'download') downloadImage(img.src, 'creatorverse-' + seed);
          else openLightbox(img.src, raw);
        });
      } catch (err) {
        limitHit = limitHit || err.code === 'limit';
        const msg = err.code === 'limit' ? 'Free hourly limit reached' : 'Busy right now, try again';
        tile.innerHTML = `<div class="shimmer" style="animation:none"><i data-lucide="image-off"></i><span>${msg}</span></div>`;
        icons();
      }
    }
    setBusy(btn, false);
    if (ok) toast(`${ok} image${ok > 1 ? 's' : ''} ready`);
    else if (limitHit) toast('Free image limit reached for this hour. Add a free Pollinations key to keep going (see README).', 'err');
    else toast('The free image service is busy. Try again in a moment.', 'err');
  }

  /* ======================================================
     PLANNER
     ====================================================== */
  function renderPlanPlatforms() {
    $('#planPlatforms').innerHTML = Object.entries(PLATFORMS).map(([id, p]) =>
      `<button type="button" data-id="${id}" class="${state.planPlatforms.has(id) ? 'on' : ''}"><i data-lucide="${p.icon}"></i>${p.name}</button>`).join('');
  }

  async function buildPlan() {
    const niche = $('#planNiche').value.trim();
    if (!niche) return;
    const days = +$('#planDays').value;
    const goal = $('#planGoal').value;
    const plats = [...state.planPlatforms];
    const out = $('#planOutput');
    const btn = $('#planGo');
    out.innerHTML = Array.from({ length: Math.min(days, 6) }, () => '<div class="skeleton"></div>').join('');
    setBusy(btn, true, 'Planning…');
    try {
      const text = await AI.chat([
        { role: 'system', content: `You are a senior content strategist. Respond with ONLY a valid JSON array, no markdown, no commentary.${brandContext()}` },
        { role: 'user', content: `Create a ${days}-day content calendar.
Niche: ${niche}
Goal: ${goal}
Platforms to rotate between: ${plats.join(', ')} (use exactly these ids).
Return a JSON array of ${days} objects, one per day, with keys:
"day" (number), "platform" (one of the ids), "format" (e.g. Carousel, Reel, Text post, Thread, Video, Article), "title" (short), "hook" (scroll-stopping first line), "idea" (1-2 sentences on what to post).` },
      ]);
      const plan = AI.extractJSON(text);
      if (!Array.isArray(plan) || !plan.length) throw new Error('Unexpected plan format');
      renderPlan(plan, niche);
      toast(`${plan.length}-day plan ready`);
    } catch (err) {
      out.innerHTML = `<div class="recent-empty">Couldn't build the plan (${esc(err.message)}). Please try again.</div>`;
    } finally {
      setBusy(btn, false);
    }
  }

  function renderPlan(plan, niche) {
    const out = $('#planOutput');
    out.innerHTML = plan.map((d, i) => {
      const pid = PLATFORMS[d.platform] ? d.platform : [...state.planPlatforms][i % state.planPlatforms.size];
      const p = PLATFORMS[pid];
      return `
      <article class="plan-card" style="animation-delay:${i * 60}ms">
        <div class="plan-top">
          <span class="day-pill">Day ${esc(d.day ?? i + 1)}</span>
          <span class="pc-tag" style="background:${p.color};margin-left:0"><i data-lucide="${p.icon}"></i>${p.name}</span>
          <span class="fmt" style="margin-left:auto">${esc(d.format || '')}</span>
        </div>
        <h3>${esc(d.title || '')}</h3>
        ${d.hook ? `<p class="plan-hook">“${esc(d.hook)}”</p>` : ''}
        <p class="idea">${esc(d.idea || '')}</p>
        <button class="btn soft" data-write="${i}" data-platform="${pid}"><i data-lucide="pen-line"></i>Write this post</button>
      </article>`;
    }).join('');
    icons();
    out.onclick = e => {
      const b = e.target.closest('[data-write]'); if (!b) return;
      const d = plan[+b.dataset.write];
      writeFrom(b.dataset.platform, `${d.title}. Hook: "${d.hook}". ${d.idea} (Format: ${d.format}; niche: ${niche})`);
    };
  }

  function writeFrom(platformId, topic) {
    goTab('posts');
    if (PLATFORMS[platformId]) state.platform = platformId;
    $$('.platform').forEach(x => x.classList.toggle('on', x.dataset.id === state.platform));
    $('#postTopic').value = topic;
    $('#postForm').requestSubmit();
  }

  /* ======================================================
     LIBRARY
     ====================================================== */
  function libItemHTML(it) {
    const date = new Date(it.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (it.type === 'image') {
      return `
        <div class="lib-item" data-id="${it.id}">
          <img src="${esc(it.url)}" alt="${esc(it.prompt)}" loading="lazy" style="aspect-ratio:${(RATIOS[it.ratio] || [1, 1]).join('/')}" />
          <div class="lib-meta"><i data-lucide="image"></i>${esc(it.style || 'Image')} · ${date}
            <span class="spacer">
              <button class="icon-btn" data-act="copy" title="Copy prompt"><i data-lucide="copy"></i></button>
              <button class="icon-btn" data-act="download" title="Download"><i data-lucide="download"></i></button>
              <button class="icon-btn" data-act="delete" title="Delete"><i data-lucide="trash-2"></i></button>
            </span></div>
        </div>`;
    }
    const p = PLATFORMS[it.platform] || PLATFORMS.instagram;
    return `
      <div class="lib-item" data-id="${it.id}">
        <div class="lib-text">${esc(it.text)}</div>
        <div class="lib-meta"><span class="pc-tag" style="background:${p.color}"><i data-lucide="${p.icon}"></i>${p.name}</span>${date}
          <span class="spacer">
            <button class="icon-btn" data-act="copy" title="Copy"><i data-lucide="copy"></i></button>
            <button class="icon-btn" data-act="delete" title="Delete"><i data-lucide="trash-2"></i></button>
          </span></div>
      </div>`;
  }

  function renderLibrary() {
    const items = state.library.filter(i => state.libFilter === 'all' || i.type === state.libFilter);
    $('#libGrid').innerHTML = items.length
      ? items.map(libItemHTML).join('')
      : `<div class="recent-empty" style="column-span:all">Nothing here yet. Everything you generate in AI Studio is saved here automatically.</div>`;
    icons();
  }

  /* ======================================================
     Wiring
     ====================================================== */
  function init() {
    renderPlatforms();
    renderStyles();
    renderPlanPlatforms();
    renderLibCount();

    $('#platformPicker').addEventListener('click', e => {
      const b = e.target.closest('.platform'); if (!b) return;
      state.platform = b.dataset.id;
      $$('.platform').forEach(x => x.classList.toggle('on', x === b));
      $('#optTags').closest('.switch').style.opacity = PLATFORMS[state.platform].md ? .5 : 1;
    });
    segBind('#postCount', v => { state.postCount = +v; });
    segBind('#imgCount', v => { state.imgCount = +v; });
    segBind('#libTabs', v => { state.libFilter = v; renderLibrary(); });

    $('#postForm').addEventListener('submit', e => {
      e.preventDefault();
      const topic = $('#postTopic').value.trim();
      if (!topic) return $('#postTopic').focus();
      generatePosts({
        topic,
        tone: $('#postTone').value,
        length: $('#postLength').value,
        audience: $('#postAudience').value.trim(),
        emoji: $('#optEmoji').checked,
        tags: $('#optTags').checked,
        cta: $('#optCta').checked,
        ctype: $('#postType').value,
        lang: $('#postLang').value,
        objective: $('#postObjective').value,
      });
    });

    $('#stylePicker').addEventListener('click', e => {
      const b = e.target.closest('.style'); if (!b) return;
      state.style = b.dataset.id;
      $$('.style').forEach(x => x.classList.toggle('on', x === b));
    });
    $('#ratioPicker').addEventListener('click', e => { const b = e.target.closest('.ratio'); if (b) selectRatio(b.dataset.r); });
    $('#enhanceBtn').addEventListener('click', enhancePrompt);
    $('#imgForm').addEventListener('submit', e => { e.preventDefault(); generateImages(); });

    $('#planPlatforms').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const id = b.dataset.id;
      if (state.planPlatforms.has(id)) { if (state.planPlatforms.size > 1) state.planPlatforms.delete(id); }
      else state.planPlatforms.add(id);
      b.classList.toggle('on', state.planPlatforms.has(id));
    });
    $('#planForm').addEventListener('submit', e => { e.preventDefault(); buildPlan(); });

    $('#libGrid').addEventListener('click', e => {
      const el = e.target.closest('.lib-item'); if (!el) return;
      const it = state.library.find(i => i.id === el.dataset.id); if (!it) return;
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'copy') copyText(it.type === 'image' ? it.prompt : it.text);
      else if (act === 'download') downloadImage(it.url, 'creatorverse-' + (it.seed || it.id));
      else if (act === 'delete') {
        el.style.transition = 'opacity .25s, transform .25s';
        el.style.opacity = 0; el.style.transform = 'scale(.96)';
        setTimeout(() => { removeFromLibrary(it.id); renderLibrary(); }, 250);
      } else if (it.type === 'image' && e.target.tagName === 'IMG') openLightbox(it.url, it.prompt);
    });
    $('#exportLib').addEventListener('click', () => {
      if (!state.library.length) return toast('Library is empty', 'err');
      const blob = new Blob([JSON.stringify(state.library, null, 2)], { type: 'application/json' });
      Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'creatorverse-library.json' }).click();
      toast('Library exported');
    });

    // Brand kit
    const dlg = $('#settingsDlg');
    const FIELDS = { brandName: 'name', brandAbout: 'about', brandVoice: 'voice', brandTags: 'tags' };
    $('#openSettings').addEventListener('click', () => {
      Object.entries(FIELDS).forEach(([id, k]) => { $('#' + id).value = state.brand[k] || ''; });
      dlg.showModal();
    });
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'save') return;
      Object.entries(FIELDS).forEach(([id, k]) => { state.brand[k] = $('#' + id).value.trim(); });
      store.set('brand', state.brand);
      toast('Brand kit saved. All new content will use it.');
    });
  }

  function show(tab) {
    const tabs = ['posts', 'images', 'planner', 'library'];
    if (!tabs.includes(tab)) tab = 'posts';
    $$('.stab').forEach(v => { v.hidden = v.id !== 'st-' + tab; });
    $$('#studioTabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
    if (tab === 'library') renderLibrary();
  }

  return { init, show, writeFrom, PLATFORMS };
})();
