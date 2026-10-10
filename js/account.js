/* Account, auth, plans and billing screens (Supabase Auth + Razorpay via Edge Functions). */
const Account = (() => {
  const { NICHE_LABEL, FEATURE_LABEL, CATEGORIES, PLATFORM_META, LANGUAGES, BUDGETS } = DATA;
  const B = Backend;
  const go = hash => { location.hash = hash; };
  const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const PENDING_EMAIL = 'cverse:pendingEmail';
  const PENDING_PAYMENT = 'cverse:pendingPayment';
  const ss = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* blocked */ } }, del: k => { try { sessionStorage.removeItem(k); } catch { /* blocked */ } } };

  const shell = (badge, icon, title, sub, inner, narrow = true) => `
    <section class="auth-wrap ${narrow ? 'narrow' : ''}">
      <div class="auth-intro"><span class="pill-badge"><i data-lucide="${icon}"></i>${badge}</span><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>
      ${inner}
    </section>`;

  // While the connection check is still running, never claim accounts are "not connected"
  const setupRequired = (what = 'Accounts') => B.initializing
    ? `<section class="auth-wrap narrow"><div class="panel connecting"><span class="dots"><i></i><i></i><i></i></span>Connecting to CreatorVerse AI accounts…</div></section>`
    : shell('Setup required', 'plug-zap', `${what}: not connected yet`,
    'This copy of CreatorVerse AI has no Supabase project configured, so sign-in, saving and payments are switched off. Browsing creators still works.',
    `<div class="panel setup-box">
      <h3>For the site owner</h3>
      ${B.configError ? `<p class="form-msg">${esc(B.configError)}</p>` : ''}
      <ol><li>Create a Supabase project and apply the SQL in <code>supabase/migrations</code>.</li>
      <li>Copy <code>.env.example</code> to <code>.env</code> in the project folder and set <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> (Supabase &gt; Project Settings &gt; API).</li>
      <li>Reload this page (the local server re-reads <code>.env</code> automatically). Full steps are in <code>SETUP.md</code>.</li></ol>
      <button class="btn primary" onclick="location.reload()"><i data-lucide="refresh-cw"></i>Check again</button>
      <a class="btn outline" href="#/explore">Browse creators</a>
    </div>`);

  const googleButton = () => B.googleEnabled
    ? `<button type="button" class="btn google block" id="googleBtn">${GOOGLE_SVG}Continue with Google</button>`
    : `<button type="button" class="btn google block" disabled title="Not configured">${GOOGLE_SVG}Continue with Google</button>
       <p class="muted sm-text center">Google sign-in isn't enabled for this project yet (Supabase &gt; Authentication &gt; Providers &gt; Google).</p>`;
  const GOOGLE_SVG = '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

  async function startGoogle(btn) {
    setBusy(btn, true, 'Redirecting to Google…');
    try { await B.auth.google(); } catch (err) { setBusy(btn, false); toast(err.message, 'err'); }
  }

  function formMsg(el, text, kind = 'err') {
    el.className = kind === 'ok' ? 'form-ok' : 'form-msg';
    el.innerHTML = text;
    el.hidden = !text;
    icons();
  }

  /* ======================================================
     LOGIN / SIGN UP / VERIFY / FORGOT / RESET
     ====================================================== */
  function renderLogin() {
    if (!B.configured) return setupRequired();
    return shell('Welcome back', 'log-in', 'Login to CreatorVerse AI', '', `
      <form class="panel auth-form" id="loginForm" novalidate>
        ${googleButton()}
        <div class="or"><span>or use email</span></div>
        <div class="field"><label class="field-label" for="lEmail">Email</label><input id="lEmail" type="email" autocomplete="email" value="${esc(ss.get(PENDING_EMAIL) || '')}" /></div>
        <div class="field"><label class="field-label" for="lPass">Password <a class="text-link right" href="#/forgot">Forgot password?</a></label>
          <div class="pw-wrap"><input id="lPass" type="password" autocomplete="current-password" /><button type="button" class="pw-toggle" data-pw="lPass" aria-label="Show password"><i data-lucide="eye"></i></button></div></div>
        <p class="form-msg" id="loginMsg" role="alert" hidden></p>
        <button class="btn primary block lg" id="loginGo">Sign in</button>
        <p class="center muted sm-text">New to CreatorVerse AI? <a class="text-link" href="#/signup">Create an account</a></p>
      </form>
      <p class="demo-note"><i data-lucide="info"></i>Clicked the verification link but the page didn't open (for example "This site can't be reached")? Your email is usually verified anyway. Make sure the site is running, then just sign in here.</p>`);
  }
  function wireLogin() {
    const form = $('#loginForm'); if (!form) return;
    $('#googleBtn')?.addEventListener('click', e => startGoogle(e.currentTarget));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('#lEmail').value.trim().toLowerCase(), msg = $('#loginMsg');
      msg.hidden = true;
      if (!validateAll([
        [$('#lEmail'), () => (!isEmail(email) ? 'Enter a valid email address.' : '')],
        [$('#lPass'), () => (!$('#lPass').value ? 'Enter your password.' : '')],
      ])) return;
      // Slow down repeated guessing in this browser. Supabase Auth's server-side rate limits are the real protection.
      const recent = store.get('loginFails', []).filter(t => Date.now() - t < 10 * 60000);
      const wait = recent.length >= 5 ? Math.ceil((recent[recent.length - 1] + 60000 * Math.min(10, 2 ** (recent.length - 5)) - Date.now()) / 1000) : 0;
      if (wait > 0) return formMsg(msg, `Too many failed attempts. Please wait ${wait} seconds, or <a class="text-link" href="#/forgot">reset your password</a>.`);
      const btn = $('#loginGo');
      setBusy(btn, true, 'Signing in…');
      try {
        await B.auth.signIn({ email, password: $('#lPass').value });
        await B.refresh();
        ss.del(PENDING_EMAIL); store.del('loginFails');
        toast(`Welcome back${B.profile?.full_name ? ', ' + B.profile.full_name.split(' ')[0] : ''}!`);
        go(App.takeNext() || (B.profile?.role ? '#/dashboard' : '#/onboarding'));
      } catch (err) {
        setBusy(btn, false);
        const raw = err.raw?.message || '';
        if (/Invalid login credentials/i.test(raw)) { B.reportLoginFailure(email, 'invalid_credentials'); store.set('loginFails', [...recent, Date.now()].slice(-20)); }
        else if (/Email not confirmed/i.test(raw)) B.reportLoginFailure(email, 'email_not_confirmed');
        const unverified = /verify your email/i.test(err.message);
        if (unverified) ss.set(PENDING_EMAIL, email);
        formMsg(msg, esc(err.message) + (unverified ? ' <a class="text-link" href="#/verify">Resend verification email</a>' : ''));
      }
    });
  }

  function renderSignup(type) {
    if (!B.configured) return setupRequired();
    const t = type === 'brand' || type === 'creator' ? type : '';
    return shell('Get started', 'sparkles', 'Create your CreatorVerse AI account', 'Free plan included. No card needed.', `
      <form class="panel auth-form" id="signupForm" novalidate>
        <div class="field"><label class="field-label">I am joining as</label>
          <div class="type-pick" id="suType" role="radiogroup">
            <label class="type-card"><input type="radio" name="suType" value="brand" ${t === 'brand' ? 'checked' : ''}><span class="hs-ico violet"><i data-lucide="briefcase"></i></span><span><b>Business / Brand</b><small>Find creators, run campaigns</small></span></label>
            <label class="type-card"><input type="radio" name="suType" value="creator" ${t === 'creator' ? 'checked' : ''}><span class="hs-ico pink"><i data-lucide="video"></i></span><span><b>Creator</b><small>Get discovered, apply to campaigns</small></span></label>
          </div></div>
        ${googleButton()}
        <div class="or"><span>or sign up with email</span></div>
        <div class="field"><label class="field-label" for="suName">Full name</label><input id="suName" autocomplete="name" /></div>
        <div class="field"><label class="field-label" for="suEmail">Email</label><input id="suEmail" type="email" autocomplete="email" /></div>
        <div class="row-2">
          <div class="field"><label class="field-label" for="suPass">Password</label><div class="pw-wrap"><input id="suPass" type="password" autocomplete="new-password" /><button type="button" class="pw-toggle" data-pw="suPass" aria-label="Show password"><i data-lucide="eye"></i></button></div></div>
          <div class="field"><label class="field-label" for="suPass2">Confirm password</label><input id="suPass2" type="password" autocomplete="new-password" /></div>
        </div>
        <p class="hint-text" id="pwHint">At least 8 characters, with a letter and a number.</p>
        <label class="check consent"><input type="checkbox" id="suAgree"><span></span><em class="consent-text">I agree to the <a class="text-link" href="#/legal/terms" target="_blank">Terms</a> and <a class="text-link" href="#/legal/privacy" target="_blank">Privacy Policy</a>.</em></label>
        <label class="check consent"><input type="checkbox" id="suNews"><span></span><em class="consent-text">Optional: email me CreatorVerse AI news and updates. You can unsubscribe at any time.</em></label>
        <p class="form-msg" id="suMsg" role="alert" hidden></p>
        <button class="btn primary block lg" id="suGo">Create account<i data-lucide="arrow-right"></i></button>
        <p class="center muted sm-text">Already have an account? <a class="text-link" href="#/login">Login</a></p>
      </form>`);
  }
  function wireSignup() {
    const form = $('#signupForm'); if (!form) return;
    $('#googleBtn')?.addEventListener('click', e => {
      const type = form.querySelector('[name=suType]:checked')?.value;
      if (type) ss.set('cverse:intendedRole', type);
      startGoogle(e.currentTarget);
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = id => $('#' + id).value.trim();
      const pw = $('#suPass').value;
      const type = form.querySelector('[name=suType]:checked')?.value;
      if (!validateAll([
        [$('#suType'), () => (!type ? 'Choose an account type.' : '')],
        [$('#suName'), () => (v('suName').length < 2 ? 'Enter your name (at least 2 characters).' : '')],
        [$('#suEmail'), () => (!isEmail(v('suEmail')) ? 'Enter a valid email address.' : '')],
        [$('#suPass'), () => (pw.length < 8 || !/[a-z]/i.test(pw) || !/\d/.test(pw) ? 'Use at least 8 characters with a letter and a number.' : '')],
        [$('#suPass2'), () => ($('#suPass2').value !== pw ? 'Passwords do not match.' : '')],
        [$('#suAgree'), () => (!$('#suAgree').checked ? 'Please accept the terms to continue.' : '')],
      ])) return;
      const btn = $('#suGo');
      setBusy(btn, true, 'Creating account…');
      try {
        const email = v('suEmail').toLowerCase();
        const data = await B.auth.signUp({ name: v('suName'), email, password: pw, accountType: type, marketingOptIn: $('#suNews').checked });
        ss.set(PENDING_EMAIL, email);
        // Supabase returns a user with no identities when the email is already registered (anti-enumeration)
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setBusy(btn, false);
          return formMsg($('#suMsg'), 'An account with this email may already exist. <a class="text-link" href="#/login">Log in</a> or <a class="text-link" href="#/forgot">reset your password</a>.');
        }
        if (data.session) { await B.refresh(); toast('Account created. Welcome to CreatorVerse AI!'); go('#/onboarding'); }
        else { toast('Account created. Check your email to verify it before logging in.'); go('#/verify'); }
      } catch (err) {
        setBusy(btn, false);
        formMsg($('#suMsg'), esc(err.message));
      }
    });
  }

  function renderVerify() {
    if (!B.configured) return setupRequired();
    if (B.session && B.verified) return shell('Verified', 'badge-check', 'Your email is verified', '', '<a class="btn primary" href="#/dashboard">Go to dashboard</a>');
    const email = ss.get(PENDING_EMAIL) || B.user?.email || '';
    return shell('Verify your email', 'mail-check', 'Check your inbox', email
      ? `Your account was created. We sent a verification link to <b>${esc(email)}</b>. You can log in after you verify your email.`
      : 'We sent you a verification link. Click it to activate your account.', `
      <div class="panel auth-form">
        <ol class="steps-list"><li>Open the email from CreatorVerse AI (check spam/promotions too).</li><li>Click <b>Verify email</b>, or enter the 6-digit code below.</li><li>You'll be signed in automatically.</li></ol>
        <form id="otpForm" novalidate>
          <div class="field"><label class="field-label" for="vEmail">Email</label><input id="vEmail" type="email" value="${esc(email)}" autocomplete="email" /></div>
          <div class="field"><label class="field-label" for="vCode">6-digit code <span class="opt">optional</span></label><input id="vCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456" /></div>
          <p class="form-msg" id="vMsg" role="alert" hidden></p>
          <div class="head-actions"><button class="btn primary" id="vGo">Verify code</button><button type="button" class="btn outline" id="vResend"><i data-lucide="refresh-cw"></i>Resend email</button></div>
        </form>
        <p class="muted sm-text">Open the email on <b>this computer</b> while the site is running: the link points to <code>localhost</code>, which only works on the device running the site. If it says "This site can't be reached", your email is usually still verified, so <a class="text-link" href="#/login">try signing in</a>.</p>
        <p class="muted sm-text">Wrong address? <a class="text-link" href="#/signup">Sign up again</a> with the right email.</p>
      </div>`);
  }
  function wireVerify() {
    const form = $('#otpForm'); if (!form) return;
    const msg = $('#vMsg');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('#vEmail').value.trim().toLowerCase(), code = $('#vCode').value.trim();
      if (!validateAll([
        [$('#vEmail'), () => (!isEmail(email) ? 'Enter your email address.' : '')],
        [$('#vCode'), () => (!/^\d{6}$/.test(code) ? 'Enter the 6-digit code from the email.' : '')],
      ])) return;
      const btn = $('#vGo');
      setBusy(btn, true, 'Verifying…');
      try {
        await B.auth.verifyCode(email, code);
        await B.refresh();
        ss.del(PENDING_EMAIL);
        toast('Email verified. Welcome!');
        go(B.profile?.role ? '#/dashboard' : '#/onboarding');
      } catch (err) { setBusy(btn, false); formMsg(msg, esc(err.message)); }
    });
    $('#vResend').addEventListener('click', async e => {
      const email = $('#vEmail').value.trim().toLowerCase();
      if (!validateAll([[$('#vEmail'), () => (!isEmail(email) ? 'Enter your email address.' : '')]])) return;
      const btn = e.currentTarget;
      setBusy(btn, true, 'Sending…');
      try {
        await B.auth.resendVerification(email);
        ss.set(PENDING_EMAIL, email);
        formMsg(msg, '<i data-lucide="check-circle-2"></i>If this email has an unverified account, a new link is on its way.', 'ok');
        let left = 60;
        btn.disabled = true;
        const t = setInterval(() => { btn.textContent = `Resend in ${--left}s`; if (left <= 0) { clearInterval(t); setBusy(btn, false); } }, 1000);
      } catch (err) { setBusy(btn, false); formMsg(msg, esc(err.message)); }
    });
  }

  function renderForgot() {
    if (!B.configured) return setupRequired();
    return shell('Password help', 'key-round', 'Reset your password', "Enter your account email and we'll send you a secure reset link.", `
      <form class="panel auth-form" id="forgotForm" novalidate>
        <div class="field"><label class="field-label" for="fEmail">Email</label><input id="fEmail" type="email" autocomplete="email" value="${esc(ss.get(PENDING_EMAIL) || '')}" /></div>
        <p class="form-msg" id="fMsg" role="alert" hidden></p>
        <button class="btn primary block lg" id="fGo">Send reset link</button>
        <p class="center muted sm-text"><a class="text-link" href="#/login">Back to login</a></p>
      </form>`);
  }
  function wireForgot() {
    const form = $('#forgotForm'); if (!form) return;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('#fEmail').value.trim().toLowerCase();
      if (!validateAll([[$('#fEmail'), () => (!isEmail(email) ? 'Enter a valid email address.' : '')]])) return;
      const btn = $('#fGo');
      setBusy(btn, true, 'Sending…');
      try {
        await B.auth.sendReset(email);
        formMsg($('#fMsg'), '<i data-lucide="check-circle-2"></i>If an account exists for this email, a reset link is on its way. It expires in 1 hour.', 'ok');
        btn.textContent = 'Link sent';
      } catch (err) { setBusy(btn, false); formMsg($('#fMsg'), esc(err.message)); }
    });
  }

  function renderReset() {
    if (!B.configured) return setupRequired();
    if (!B.session) return shell('Password help', 'key-round', 'Reset link expired', 'Open the newest reset email, or request a new link.', '<a class="btn primary" href="#/forgot">Request a new link</a>');
    return shell('Password help', 'key-round', 'Choose a new password', '', `
      <form class="panel auth-form" id="resetForm" novalidate>
        <div class="field"><label class="field-label" for="rPass">New password</label><input id="rPass" type="password" autocomplete="new-password" /></div>
        <div class="field"><label class="field-label" for="rPass2">Confirm new password</label><input id="rPass2" type="password" autocomplete="new-password" /></div>
        <p class="form-msg" id="rMsg" role="alert" hidden></p>
        <button class="btn primary block lg" id="rGo">Update password</button>
      </form>`);
  }
  function wireReset() {
    const form = $('#resetForm'); if (!form) return;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const pw = $('#rPass').value;
      if (!validateAll([
        [$('#rPass'), () => (pw.length < 8 || !/[a-z]/i.test(pw) || !/\d/.test(pw) ? 'Use at least 8 characters with a letter and a number.' : '')],
        [$('#rPass2'), () => ($('#rPass2').value !== pw ? 'Passwords do not match.' : '')],
      ])) return;
      const btn = $('#rGo');
      setBusy(btn, true, 'Saving…');
      try { await B.auth.updatePassword(pw); toast('Password updated'); go('#/dashboard'); }
      catch (err) { setBusy(btn, false); formMsg($('#rMsg'), esc(err.message)); }
    });
  }

  /* ======================================================
     ONBOARDING + ROLE PROFILE FORMS
     ====================================================== */
  const plats = () => Object.entries(PLATFORM_META).map(([id, p]) => [id, p.name, p.icon]);

  function brandForm(bp = {}) {
    return `
      <div class="row-2">
        <div class="field"><label class="field-label" for="bpName">Business name</label><input id="bpName" value="${esc(bp.business_name || B.profile?.full_name || '')}" /></div>
        <div class="field"><label class="field-label" for="bpIndustry">Industry</label><select id="bpIndustry"><option value="">Select an industry</option>${['Beauty & personal care', 'Fashion & apparel', 'Food & beverage', 'Consumer tech', 'Education', 'Health & fitness', 'Travel & hospitality', 'Gaming & entertainment', 'Finance', 'Other'].map(x => `<option ${bp.industry === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label class="field-label" for="bpDesc">Business description</label><textarea id="bpDesc" rows="3" placeholder="What do you sell, and to whom?">${esc(bp.description || '')}</textarea></div>
      <div class="field"><label class="field-label">Campaign goals</label>${chipPicker('bpGoals', ['Brand awareness', 'Product launch', 'Drive sales', 'App installs', 'Event promotion'].map(g => [g, g]), bp.goals || [])}</div>
      <div class="field"><label class="field-label" for="bpAudience">Target audience</label><input id="bpAudience" value="${esc(bp.target_audience || '')}" placeholder="e.g. College students in Hyderabad, 18–24" /></div>
      <div class="row-2">
        <div class="field"><label class="field-label">Preferred platforms</label>${chipPicker('bpPlats', plats(), bp.platforms || [])}</div>
        <div class="field"><label class="field-label" for="bpBudget">Budget per creator</label><select id="bpBudget">${BUDGETS.map(b => `<option value="${b.id}" ${bp.budget_bracket === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}</select></div>
      </div>`;
  }
  function readBrandForm() {
    const v = id => $('#' + id).value.trim();
    const ok = validateAll([
      [$('#bpName'), () => (v('bpName').length < 2 ? 'Enter your business name.' : '')],
      [$('#bpIndustry'), () => (!v('bpIndustry') ? 'Choose your industry.' : '')],
      [$('#bpDesc'), () => (v('bpDesc').length < 20 ? 'Describe your business in at least 20 characters.' : '')],
      [$('#bpGoals'), () => (!chipValues('#bpGoals').length ? 'Pick at least one goal.' : '')],
      [$('#bpPlats'), () => (!chipValues('#bpPlats').length ? 'Pick at least one platform.' : '')],
    ]);
    return ok && { business_name: v('bpName'), industry: v('bpIndustry'), description: v('bpDesc'), goals: chipValues('#bpGoals'),
      target_audience: v('bpAudience'), platforms: chipValues('#bpPlats'), budget_bracket: v('bpBudget') };
  }

  function creatorForm(cp = {}) {
    const links = Object.fromEntries((cp.creator_social_links || []).map(l => [l.platform, l.url]));
    return `
      <div class="row-2">
        <div class="field"><label class="field-label" for="cpName">Display name</label><input id="cpName" value="${esc(cp.display_name || B.profile?.full_name || '')}" /></div>
        <div class="field"><label class="field-label" for="cpCity">City</label><input id="cpCity" value="${esc(cp.city || '')}" placeholder="e.g. Hyderabad" /></div>
      </div>
      <div class="field"><label class="field-label" for="cpBio">Biography</label><textarea id="cpBio" rows="3" placeholder="What do you create, and for whom?">${esc(cp.bio || '')}</textarea></div>
      <div class="field"><label class="field-label">Niches <span class="opt">up to 3</span></label><div data-max="3" class="chips-wrap">${chipPicker('cpNiches', CATEGORIES.map(c => [c.id, NICHE_LABEL[c.id]]), cp.niches || [])}</div></div>
      <div class="field"><label class="field-label">Languages</label>${chipPicker('cpLangs', LANGUAGES.map(l => [l, l]), cp.languages || ['English'])}</div>
      <div class="field"><label class="field-label">Social links <span class="opt">https:// links to your profiles</span></label>
        <div class="links-grid">${Object.entries(PLATFORM_META).map(([id, p]) => `<label class="link-input"><i data-lucide="${p.icon}" style="color:${p.color}"></i><input data-link="${id}" value="${esc(links[id] || '')}" placeholder="${p.name} URL" /></label>`).join('')}</div></div>
      <div class="row-2">
        <div class="field"><label class="field-label" for="cpPrice">Starting price (₹)</label><input id="cpPrice" type="number" min="0" step="500" value="${cp.price_from ?? ''}" /></div>
        <div class="field"><label class="field-label">&nbsp;</label><label class="switch"><input type="checkbox" id="cpPublish" ${cp.published ? 'checked' : ''} /><span></span>Publish my profile to brands</label></div>
      </div>
      <div class="field"><label class="field-label" for="cpPackages">Service packages &amp; pricing</label><textarea id="cpPackages" rows="3" placeholder="Basic: 1 Reel, 3 days, ₹5,000&#10;Standard: Reel + 3 Stories, 5 days, ₹11,000">${esc(cp.packages || '')}</textarea></div>`;
  }
  function readCreatorForm() {
    const v = id => $('#' + id).value.trim();
    const links = $$('[data-link]').map(i => ({ platform: i.dataset.link, url: i.value.trim() })).filter(l => l.url);
    const badLink = $$('[data-link]').find(i => i.value.trim() && !/^https:\/\/\S+\.\S+$/.test(i.value.trim()));
    const ok = validateAll([
      [$('#cpName'), () => (v('cpName').length < 2 ? 'Enter a display name.' : '')],
      [$('#cpBio'), () => (v('cpBio').length < 20 ? 'Write at least 20 characters about yourself.' : '')],
      [$('#cpNiches'), () => (!chipValues('#cpNiches').length ? 'Pick at least one niche.' : '')],
      [$('#cpLangs'), () => (!chipValues('#cpLangs').length ? 'Pick at least one language.' : '')],
      [$('.links-grid'), () => (badLink ? `Check the ${PLATFORM_META[badLink.dataset.link].name} link: it must start with https://` : '')],
      [$('#cpPrice'), () => (v('cpPrice') && !(+v('cpPrice') >= 0) ? 'Enter a valid price.' : '')],
    ]);
    return ok && { profile: { display_name: v('cpName'), city: v('cpCity'), bio: v('cpBio'), niches: chipValues('#cpNiches'), languages: chipValues('#cpLangs'),
      price_from: v('cpPrice') ? +v('cpPrice') : null, packages: v('cpPackages'), published: $('#cpPublish').checked }, links };
  }

  function renderOnboarding() {
    if (!B.configured) return setupRequired();
    const role = B.profile?.role;
    if (!role) {
      const intended = ss.get('cverse:intendedRole');
      return shell('One more step', 'user-round-check', 'How will you use CreatorVerse AI?', 'Choose once: creator and brand accounts have different dashboards.', `
        <div class="role-cards">
          <button class="role-card" data-pick-role="brand"><span class="hs-ico violet"><i data-lucide="briefcase"></i></span><h2>Business / Brand</h2><p>Find creators, run AI matching, post campaigns.</p>${intended === 'brand' ? '<span class="pill-badge">You picked this</span>' : ''}</button>
          <button class="role-card" data-pick-role="creator"><span class="hs-ico pink"><i data-lucide="video"></i></span><h2>Creator</h2><p>Publish your profile and apply to brand campaigns.</p>${intended === 'creator' ? '<span class="pill-badge">You picked this</span>' : ''}</button>
        </div>`, false);
    }
    return shell('Set up your profile', role === 'brand' ? 'briefcase' : 'video', role === 'brand' ? 'Tell creators about your brand' : 'Build your creator profile',
      'You can change these details any time in Account settings.', `
      <form class="panel auth-form" id="roleForm" novalidate>
        <div id="roleFields"><div class="skeleton" style="height:200px"></div></div>
        <p class="form-msg" id="obMsg" role="alert" hidden></p>
        <div class="head-actions"><button class="btn primary lg" id="obGo">Save and continue<i data-lucide="arrow-right"></i></button><a class="btn soft lg" href="#/dashboard">Skip for now</a></div>
      </form>`, false);
  }
  async function wireOnboarding() {
    $$('[data-pick-role]').forEach(b => b.addEventListener('click', async () => {
      setBusy(b, true, 'Saving…');
      try { await B.db.updateProfile({ role: b.dataset.pickRole }); ss.del('cverse:intendedRole'); App.route(); }
      catch (err) { setBusy(b, false); toast(err.message, 'err'); }
    }));
    if ($('#roleForm')) await wireRoleForm('#roleForm', '#obMsg', '#obGo', () => go('#/dashboard'));
  }

  async function wireRoleForm(formSel, msgSel, btnSel, after) {
    const form = $(formSel), role = B.profile.role;
    try {
      const existing = role === 'brand' ? await B.db.brandProfile() : await B.db.creatorProfile();
      $('#roleFields').innerHTML = role === 'brand' ? brandForm(existing || {}) : creatorForm(existing || {});
      icons();
    } catch (err) { $('#roleFields').innerHTML = `<p class="form-msg">${esc(err.message)}</p>`; return; }
    bindChips(form);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const data = role === 'brand' ? readBrandForm() : readCreatorForm();
      if (!data) return;
      const btn = $(btnSel);
      setBusy(btn, true, 'Saving…');
      try {
        if (role === 'brand') await B.db.saveBrandProfile(data);
        else await B.db.saveCreatorProfile(data.profile, data.links);
        setBusy(btn, false);
        toast('Profile saved');
        after?.();
      } catch (err) { setBusy(btn, false); formMsg($(msgSel), esc(err.message)); }
    });
  }

  /* ======================================================
     ACCOUNT SETTINGS
     ====================================================== */
  function renderAccount() {
    if (!B.configured) return setupRequired();
    const p = B.profile || {}, u = B.user;
    const google = (u.app_metadata?.providers || []).includes('google');
    return `
    <section class="page-head"><div><span class="pill-badge"><i data-lucide="user-round-cog"></i>Account</span><h1>Account settings</h1>
      <p class="muted">${esc(u.email)} · ${p.role === 'creator' ? 'Creator' : p.role === 'brand' ? 'Business / Brand' : 'Account type not chosen'} account${google ? ' · signed in with Google' : ''}</p></div>
      <div class="head-actions"><a class="btn outline" href="#/billing"><i data-lucide="credit-card"></i>Plan &amp; billing</a><button class="btn soft" data-signout><i data-lucide="log-out"></i>Sign out</button></div></section>
    <div class="settings-grid">
      <form class="panel" id="nameForm" novalidate>
        <h3>Profile</h3>
        <div class="field"><label class="field-label" for="acName">Full name</label><input id="acName" value="${esc(p.full_name || '')}" autocomplete="name" /></div>
        <button class="btn primary" id="acNameGo">Save name</button>
      </form>
      <form class="panel" id="prefsForm">
        <h3>Email notifications</h3>
        <p class="muted sm-text">Account security, payment confirmations and payment failures are always emailed.</p>
        <div id="prefsBox"><div class="skeleton" style="height:90px"></div></div>
      </form>
      ${p.role ? `<form class="panel span-2" id="roleForm" novalidate>
        <h3>${p.role === 'brand' ? 'Brand profile' : 'Creator profile'}</h3>
        <div id="roleFields"><div class="skeleton" style="height:200px"></div></div>
        <p class="form-msg" id="roleMsg" role="alert" hidden></p>
        <button class="btn primary" id="roleGo">Save ${p.role} profile</button>
      </form>` : `<div class="panel span-2"><h3>Account type</h3><p class="muted">Choose whether you're a brand or a creator.</p><a class="btn primary" href="#/onboarding">Choose account type</a></div>`}
      <form class="panel" id="emailForm" novalidate>
        <h3>Sign-in email</h3>
        <div class="field"><label class="field-label" for="acEmail">New email</label><input id="acEmail" type="email" autocomplete="email" placeholder="${esc(u.email)}" /></div>
        <p class="form-msg" id="emailMsg" role="alert" hidden></p>
        <button class="btn outline" id="acEmailGo">Change email</button>
      </form>
      <form class="panel" id="pwForm" novalidate>
        <h3>Password</h3>
        <div class="field"><label class="field-label" for="acPw">New password</label><input id="acPw" type="password" autocomplete="new-password" /></div>
        <div class="field"><label class="field-label" for="acPw2">Confirm</label><input id="acPw2" type="password" autocomplete="new-password" /></div>
        <p class="form-msg" id="pwMsg" role="alert" hidden></p>
        <button class="btn outline" id="acPwGo">${google ? 'Set a password' : 'Change password'}</button>
      </form>
    </div>`;
  }
  async function wireAccount() {
    if (!$('#nameForm')) return;
    $('#nameForm').addEventListener('submit', async e => {
      e.preventDefault();
      const name = $('#acName').value.trim();
      if (!validateAll([[$('#acName'), () => (name.length < 2 ? 'Enter your name.' : '')]])) return;
      const btn = $('#acNameGo'); setBusy(btn, true, 'Saving…');
      try { await B.db.updateProfile({ full_name: name }); toast('Name saved'); } catch (err) { toast(err.message, 'err'); }
      setBusy(btn, false);
    });
    $('#emailForm').addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('#acEmail').value.trim().toLowerCase();
      if (!validateAll([[$('#acEmail'), () => (!isEmail(email) ? 'Enter a valid email address.' : email === B.user.email ? 'That is already your email.' : '')]])) return;
      const btn = $('#acEmailGo'); setBusy(btn, true, 'Sending…');
      try { await B.auth.updateEmail(email); formMsg($('#emailMsg'), '<i data-lucide="check-circle-2"></i>Check both inboxes: the change completes after you confirm the link we sent.', 'ok'); }
      catch (err) { formMsg($('#emailMsg'), esc(err.message)); }
      setBusy(btn, false);
    });
    $('#pwForm').addEventListener('submit', async e => {
      e.preventDefault();
      const pw = $('#acPw').value;
      if (!validateAll([
        [$('#acPw'), () => (pw.length < 8 || !/[a-z]/i.test(pw) || !/\d/.test(pw) ? 'Use at least 8 characters with a letter and a number.' : '')],
        [$('#acPw2'), () => ($('#acPw2').value !== pw ? 'Passwords do not match.' : '')],
      ])) return;
      const btn = $('#acPwGo'); setBusy(btn, true, 'Saving…');
      try { await B.auth.updatePassword(pw); $('#pwForm').reset(); formMsg($('#pwMsg'), '<i data-lucide="check-circle-2"></i>Password updated. We emailed you a security notice.', 'ok'); }
      catch (err) { formMsg($('#pwMsg'), esc(err.message)); }
      setBusy(btn, false);
    });
    try {
      const prefs = { email_activity: true, email_usage: true, email_billing: true, email_login: true, email_messages: true, email_marketing: false, ...(await B.db.prefs()) };
      const row = (k, label, help) => `<label class="switch pref"><input type="checkbox" data-pref="${k}" ${prefs[k] ? 'checked' : ''} /><span></span><div><b>${label}</b><small>${help}</small></div></label>`;
      $('#prefsBox').innerHTML = row('email_activity', 'Campaign activity', 'Campaign launches, applications and requests')
        + row('email_usage', 'Plan usage', 'When you near or reach a free-plan limit')
        + row('email_billing', 'Billing reminders', 'Renewals (failures are always sent)')
        + row('email_login', 'Sign-in alerts', 'An email each time your account is signed in to (recommended)')
        + row('email_messages', 'New messages', 'At most one email per conversation per hour; the message text is never emailed')
        + row('email_marketing', 'News &amp; updates', 'Occasional CreatorVerse AI announcements. Off unless you opt in; every email has a one-click unsubscribe');
      $('#prefsBox').addEventListener('change', async e => {
        const k = e.target.dataset.pref; if (!k) return;
        try { await B.db.savePrefs({ [k]: e.target.checked }); toast('Preferences saved'); }
        catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'err'); }
      });
    } catch (err) { $('#prefsBox').innerHTML = `<p class="form-msg">${esc(err.message)}</p>`; }
    if ($('#roleForm')) await wireRoleForm('#roleForm', '#roleMsg', '#roleGo');
  }

  /* ======================================================
     NOTIFICATIONS
     ====================================================== */
  const NOTIF_ICON = { welcome: 'party-popper', security: 'shield-alert', campaign_created: 'rocket', application_received: 'inbox', application_sent: 'send',
    application_update: 'clipboard-check', request_sent: 'send', usage_warning: 'gauge', limit_reached: 'octagon-alert', subscription_active: 'crown',
    subscription_renewed: 'refresh-cw', subscription_cancel_scheduled: 'calendar-x', subscription_ended: 'circle-off', payment_failed: 'credit-card', profile_published: 'badge-check',
    admin_new_user: 'user-plus', account_pending: 'hourglass', account_approved: 'badge-check', account_rejected: 'circle-x', account_suspended: 'shield-alert' };
  const notifItem = n => `<a class="np-item ${n.read_at ? '' : 'new'}" href="${esc(n.link || '#/notifications')}" data-notif="${n.id}">
      <span class="np-ico"><i data-lucide="${NOTIF_ICON[n.kind] || 'bell'}"></i></span>
      <div><p><b>${esc(n.title)}</b></p>${n.body ? `<p class="muted">${esc(n.body)}</p>` : ''}<small>${timeAgo(new Date(n.created_at).getTime())} ago</small></div></a>`;

  function renderNotifications() {
    if (!B.configured) return setupRequired('Notifications');
    return `<section class="page-head"><div><span class="pill-badge"><i data-lucide="bell"></i>Notifications</span><h1>Notifications</h1>
      <p class="muted">Important updates about your account, campaigns and plan. Email copies follow your <a class="text-link" href="#/account">preferences</a>.</p></div>
      <button class="btn outline" id="markAllRead"><i data-lucide="check-check"></i>Mark all read</button></section>
      <div class="panel notif-list" id="notifList"><div class="skeleton" style="height:160px"></div></div>`;
  }
  async function wireNotifications() {
    if (!$('#notifList')) return;
    try {
      const list = await B.db.notifications(100);
      $('#notifList').innerHTML = list.length ? list.map(notifItem).join('') : '<div class="empty-inline"><i data-lucide="bell-off"></i><p>No notifications yet.</p></div>';
      icons();
      $('#markAllRead').onclick = async () => {
        const ids = list.filter(n => !n.read_at).map(n => n.id);
        if (ids.length) await B.db.markRead(ids);
        App.refreshChrome(); App.route();
      };
    } catch (err) { $('#notifList').innerHTML = `<p class="form-msg">${esc(err.message)}</p>`; }
  }

  /* ======================================================
     PLANS, UPGRADE DIALOG, CHECKOUT, BILLING
     ====================================================== */
  let plansCache = null;
  async function plans() {
    if (!B.configured) return null;
    if (!plansCache) plansCache = await B.db.plans();
    return plansCache;
  }

  async function upgradeDialog(err) {
    // fill in used / limit / reset date from the server-side plan snapshot when the error lacks them
    await B.refresh().catch(() => {});
    const info = { ...(B.plan?.usage?.find(u => u.feature === err?.feature) || {}), ...(err?.info || {}) };
    const label = FEATURE_LABEL[err?.feature] || 'this feature';
    const premium = (await plans().catch(() => null))?.find(p => p.id === 'premium_monthly');
    const body = openModal(`
      <div class="modal-head"><h2><i data-lucide="crown"></i>${err?.feature ? 'Free limit reached' : 'Premium feature'}</h2><button class="icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button></div>
      ${err?.feature ? `<p>You've used <b>${info.used ?? info.limit ?? ''}${info.limit != null ? ` of ${info.limit}` : ''} ${label}</b> on the ${B.tier === 'premium' ? 'Premium' : 'Free'} plan${info.period && info.period !== 'lifetime' ? ` this ${info.period}` : ''}.</p>
        ${info.resets_at && info.period !== 'lifetime' ? `<p class="muted sm-text">Your limit resets on ${fmtDate(info.resets_at)}. Everything else on your plan keeps working.</p>` : '<p class="muted sm-text">Remove some items, or upgrade for a higher limit. Everything else keeps working.</p>'}`
        : '<p>This is part of CreatorVerse AI Premium.</p>'}
      ${premium ? `<div class="upgrade-box"><b>Premium includes</b><ul class="pkg-list">${premium.features.map(f => `<li><i data-lucide="check"></i>${esc(f)}</li>`).join('')}</ul></div>` : ''}
      <div class="modal-foot"><button class="btn soft" data-close>Not now</button><a class="btn primary" href="#/pricing" data-close><i data-lucide="crown"></i>Upgrade to Premium</a></div>`);
    body.onclick = e => { if (e.target.closest('[data-close]')) closeModal(); };
  }

  // Wraps a metered action: counts it on the server, shows the upgrade dialog when denied.
  async function meter(feature) {
    try { await B.consume(feature); return true; }
    catch (err) {
      if (err instanceof QuotaError) { upgradeDialog(err); return false; }
      toast(err.message, 'err');
      return false;
    }
  }

  function planCard(p, cur) {
    const isCur = cur === p.id || (cur === 'free' && p.id === 'free');
    const per = p.billing_interval === 'year' ? '/ year' : p.billing_interval === 'month' ? '/ month' : 'forever';
    const pop = p.id === 'premium_yearly';
    let cta;
    if (isCur) cta = '<span class="btn soft block" aria-disabled="true">Current plan</span>';
    else if (p.tier === 'free') cta = '<a class="btn outline block" href="#/dashboard">Go to dashboard</a>';
    else if (B.tier === 'premium') cta = '<a class="btn outline block" href="#/billing">Manage in Billing</a>';
    else cta = `<button class="btn ${pop ? 'primary' : 'outline'} block" data-checkout="${p.id}" ${p.razorpay_plan_id ? '' : 'disabled title="Not connected to Razorpay yet"'}>Upgrade to ${esc(p.name)}</button>`;
    return `<article class="price-card ${pop ? 'pop' : ''}">
      ${pop ? '<span class="price-pop">Best value</span>' : ''}
      <h2>${esc(p.name)}</h2><p class="muted">${esc(p.description)}</p>
      <div class="price"><b>${p.price_inr ? inr(p.price_inr) : 'Free'}</b><span>${per}</span></div>
      <ul class="pkg-list">${p.features.map(f => `<li><i data-lucide="check"></i>${esc(f)}</li>`).join('')}</ul>
      ${cta}
      ${p.tier === 'premium' && !p.razorpay_plan_id ? '<p class="muted sm-text">Checkout opens once the admin links a Razorpay plan ID.</p>' : ''}
    </article>`;
  }

  function renderPricing() {
    return `
    <section class="page-head center-head"><div><span class="pill-badge"><i data-lucide="tag"></i>Pricing</span>
      <h1>Simple plans for every brand</h1>
      <p class="muted" id="priceSub">Start free. Upgrade when you need higher limits and advanced filters.</p></div></section>
    <div class="price-grid" id="priceGrid">${B.configured ? '<div class="skeleton" style="height:360px"></div>'.repeat(3) : ''}</div>
    ${B.configured ? '' : '<p class="demo-note"><i data-lucide="info"></i>Plans load from the database once Supabase is configured. See SETUP.md.</p>'}
    <p class="pay-note"><i data-lucide="lock"></i>Payments are processed securely by Razorpay. CreatorVerse AI never sees or stores your card details. Premium starts only after Razorpay confirms the payment.</p>`;
  }
  // Shown when no backend is configured (mirrors the seed rows in the migration)
  const FALLBACK_PLANS = [
    { id: 'free', tier: 'free', name: 'Free', description: 'For brands and creators getting started.', price_inr: 0, billing_interval: null, is_active: true,
      features: ['10 creator profile views / month', '5 searches / month', '3 AI matching requests / month', '1 campaign / month', '5 saved creators'] },
    { id: 'premium_monthly', tier: 'premium', name: 'Premium Monthly', description: 'Higher limits and advanced filters, billed monthly.', price_inr: 999, billing_interval: 'month', is_active: true,
      features: ['Unlimited creator profile views', '500 searches / month', '100 AI matching requests / month', '20 campaigns / month', '200 saved creators', 'Advanced filters (audience size, rating)'] },
    { id: 'premium_yearly', tier: 'premium', name: 'Premium Yearly', description: 'Everything in Premium Monthly, two months free.', price_inr: 9990, billing_interval: 'year', is_active: true,
      features: ['Unlimited creator profile views', '500 searches / month', '100 AI matching requests / month', '20 campaigns / month', '200 saved creators', 'Advanced filters (audience size, rating)'] },
  ];

  async function wirePricing() {
    if (!B.configured) {
      $('#priceGrid').innerHTML = FALLBACK_PLANS.map(p => planCard(p, null)).join('');
      $('#priceSub').insertAdjacentHTML('beforeend', ' <span class="sample-note"><i data-lucide="info"></i>Sample prices.</span>');
      return icons();
    }
    try {
      const list = (await plans()).filter(p => p.is_active);
      const cur = B.tier === 'premium' ? B.plan?.subscription?.plan_id : 'free';
      $('#priceGrid').innerHTML = list.map(p => planCard(p, B.session ? cur : null)).join('');
      if (B.settings.prices_are_samples !== false) $('#priceSub').insertAdjacentHTML('beforeend', ' <span class="sample-note"><i data-lucide="info"></i>Sample prices: final pricing is set by the admin.</span>');
      icons();
      $('#priceGrid').addEventListener('click', e => { const b = e.target.closest('[data-checkout]'); if (b) checkout(b.dataset.checkout, b); });
    } catch (err) { $('#priceGrid').innerHTML = `<p class="form-msg">${esc(err.message)}</p>`; }
  }

  async function checkout(planId, btn) {
    if (!B.session) { App.setNext('#/pricing'); return go('#/login'); }  // session ended: back to the single entrance login
    if (!B.verified) return go('#/verify');
    setBusy(btn, true, 'Starting secure checkout…');
    try {
      const s = await B.fn('create-subscription', { plan_id: planId });
      await loadScript('https://checkout.razorpay.com/v1/checkout.js');
      const rzp = new window.Razorpay({
        key: s.key_id,
        subscription_id: s.subscription_id,
        name: 'CreatorVerse AI',
        description: `${s.plan.name}${s.test_mode ? ' (TEST MODE)' : ''}`,
        prefill: s.prefill,
        theme: { color: '#8138E8' },
        handler: resp => { ss.set(PENDING_PAYMENT, JSON.stringify(resp)); go('#/payment/success'); },
        modal: { ondismiss: () => { setBusy(btn, false); go('#/payment/cancelled'); } },
      });
      rzp.on('payment.failed', r => { toast(`Payment failed: ${r.error?.description || 'please try another method'}`, 'err'); });
      rzp.open();
    } catch (err) {
      setBusy(btn, false);
      toast(err.message, 'err');
    }
  }

  function renderPayment(kind) {
    if (kind === 'cancelled') return shell('Checkout', 'circle-x', 'Checkout cancelled', 'No payment was taken and your plan has not changed.',
      '<div class="head-actions"><a class="btn primary" href="#/pricing">Back to plans</a><a class="btn soft" href="#/dashboard">Go to dashboard</a></div>');
    return shell('Checkout', 'shield-check', 'Confirming your payment', 'We confirm every payment with Razorpay on our server before activating Premium.', `
      <div class="panel pay-status" id="payStatus"><div class="thinking"><span class="dots"><i></i><i></i><i></i></span>Verifying with Razorpay…</div></div>`);
  }
  async function wirePayment(kind) {
    if (kind === 'cancelled' || !$('#payStatus')) return;
    const box = $('#payStatus');
    const show = (icon, title, text, actions = '') => { box.innerHTML = `<div class="pay-result"><span class="success-ico sm"><i data-lucide="${icon}"></i></span><div><h3>${title}</h3><p class="muted">${text}</p>${actions}</div></div>`; icons(); };
    if (!B.session) { App.setNext(location.hash); return go('#/login'); }
    const raw = ss.get(PENDING_PAYMENT);
    try {
      if (raw) {
        const r = await B.fn('verify-subscription', JSON.parse(raw));
        ss.del(PENDING_PAYMENT);
        if (r.premium) { await B.refresh(); confetti(); return show('crown', 'Premium is active', r.message, '<a class="btn primary" href="#/billing">View billing</a>'); }
        box.innerHTML = `<div class="thinking"><span class="dots"><i></i><i></i><i></i></span>${esc(r.message)}</div>`;
      }
      // Poll the database (updated by the verified webhook) for up to ~2 minutes
      for (let i = 0; i < 40; i++) {
        await B.refresh();
        if (B.tier === 'premium') { confetti(); return show('crown', 'Premium is active', 'Razorpay confirmed your payment.', '<a class="btn primary" href="#/billing">View billing</a>'); }
        if (!location.hash.startsWith('#/payment')) return;
        await new Promise(r => setTimeout(r, 3000));
      }
      show('hourglass', 'Still waiting for confirmation', "Razorpay hasn't confirmed the payment yet. You'll get an email and a notification as soon as it does. You haven't been charged twice.", '<a class="btn outline" href="#/billing">Check billing status</a>');
    } catch (err) {
      show('alert-circle', 'We could not confirm this payment', esc(err.message) + ' If money was deducted, it will be confirmed by Razorpay or refunded automatically.', '<a class="btn outline" href="#/billing">Billing</a>');
    }
  }

  function usageMeters(plan = B.plan) {
    if (!plan?.usage) return '';
    return `<div class="usage-list">${plan.usage.map(u => {
      const pct = u.limit == null ? 0 : Math.min(100, Math.round((u.used / Math.max(1, u.limit)) * 100));
      return `<div class="usage-row ${pct >= 100 ? 'full' : pct >= 80 ? 'warn' : ''}">
        <div class="usage-top"><span>${FEATURE_LABEL[u.feature]}</span><b>${u.used}${u.limit == null ? ' · unlimited' : ` / ${u.limit}`}</b></div>
        ${u.limit == null ? '' : `<div class="meter-bar wide"><i style="width:${pct}%"></i></div>`}
        <small class="muted">${u.period === 'lifetime' ? 'Total at any time' : `Resets ${fmtDate(u.resets_at)}`}</small></div>`;
    }).join('')}</div>`;
  }

  function renderBilling() {
    if (!B.configured) return setupRequired('Billing');
    const sub = B.plan?.subscription;
    const premium = B.tier === 'premium';
    const statusText = { created: 'Checkout started (not paid)', authenticated: 'Payment authorised, awaiting charge', active: 'Active', pending: 'Payment retrying',
      halted: 'Paused: payment failed', cancelled: 'Cancelled', completed: 'Completed', expired: 'Expired' };
    return `
    <section class="page-head"><div><span class="pill-badge"><i data-lucide="credit-card"></i>Billing</span><h1>Plan &amp; billing</h1>
      <p class="muted">Your plan, usage and subscription. Payments are handled by Razorpay.</p></div></section>
    <div class="settings-grid">
      <div class="panel plan-panel">
        <span class="plan-badge ${premium ? 'premium' : ''}"><i data-lucide="${premium ? 'crown' : 'leaf'}"></i>${premium ? 'Premium' : 'Free plan'}</span>
        ${sub ? `<dl class="kv">
          <dt>Subscription</dt><dd>${esc(sub.plan_id.replace('_', ' '))}</dd>
          <dt>Status</dt><dd>${esc(statusText[sub.status] || sub.status)}${sub.cancel_at_period_end ? ' · will not renew' : ''}</dd>
          ${sub.current_period_end ? `<dt>${sub.cancel_at_period_end || !['active', 'pending'].includes(sub.status) ? 'Access until' : 'Renews on'}</dt><dd>${fmtDate(sub.current_period_end)}</dd>` : ''}
        </dl>` : '<p class="muted">You are on the Free plan.</p>'}
        <div class="head-actions">
          ${premium ? (sub?.cancel_at_period_end ? '' : '<button class="btn outline" id="cancelSub"><i data-lucide="calendar-x"></i>Cancel subscription</button>')
            : '<a class="btn primary" href="#/pricing"><i data-lucide="crown"></i>Upgrade to Premium</a>'}
        </div>
        ${premium ? '<p class="muted sm-text">To update your card or UPI mandate, use the link in Razorpay\'s subscription email, or cancel and subscribe again.</p>' : ''}
      </div>
      <div class="panel"><h3>Usage this period</h3>${usageMeters()}</div>
    </div>`;
  }
  function wireBilling() {
    $('#cancelSub')?.addEventListener('click', () => {
      const body = openModal(`
        <div class="modal-head"><h2><i data-lucide="calendar-x"></i>Cancel Premium?</h2><button class="icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button></div>
        <p>Your subscription won't renew. You keep Premium until the end of the current billing period, then your account moves to the Free plan. Your data stays safe.</p>
        <div class="modal-foot"><button class="btn soft" data-close>Keep Premium</button><button class="btn primary" id="confirmCancel">Cancel at period end</button></div>`);
      body.onclick = async e => {
        if (e.target.closest('[data-close]')) return closeModal();
        const btn = e.target.closest('#confirmCancel'); if (!btn) return;
        setBusy(btn, true, 'Cancelling…');
        try { await B.fn('cancel-subscription'); await B.refresh(); closeModal(); toast('Subscription will not renew'); App.route(); }
        catch (err) { setBusy(btn, false); toast(err.message, 'err'); }
      };
    });
  }

  /* ======================================================
     ADMIN (writes are enforced by RLS: only rows in app_admins)
     ====================================================== */
  function renderAdmin() {
    if (!B.configured) return setupRequired('Admin tools');
    if (!B.isAdmin) return shell('Admin', 'shield', 'Admins only', 'Your account does not have administrator access.', '<a class="btn primary" href="#/dashboard">Back to dashboard</a>');
    return `<section class="page-head"><div><span class="pill-badge"><i data-lucide="shield"></i>Admin</span><h1>Admin dashboard</h1>
      <p class="muted">Users, approvals, plans, limits and settings. Every action is re-checked by the database; non-admin accounts are rejected.</p></div></section>
      <div id="adminUsers" class="admin-users"><div class="skeleton" style="height:220px"></div></div>
      <h2 class="h-sec">Analytics &amp; emails</h2>
      ${AdminAnalytics.render()}
      <h2 class="h-sec">Plans, limits &amp; settings</h2>
      <div id="adminBox"><div class="skeleton" style="height:300px"></div></div>`;
  }

  /* ---------- Admin: overview + user approvals ---------- */
  const STATUS_TABS = [['pending', 'Pending'], ['active', 'Active'], ['rejected', 'Rejected'], ['suspended', 'Suspended'], ['', 'All']];
  let adminFilter = 'pending', adminSearch = '';

  async function drawAdminUsers() {
    const box = $('#adminUsers');
    if (!box) return;
    try {
      const [stats, users] = await Promise.all([B.db.adminStats(), B.db.adminListUsers(adminFilter || null, adminSearch)]);
      const approvalOn = B.settings.require_account_approval === true;
      box.innerHTML = `
        <div class="kpi-grid admin-kpis">
          ${[['users', 'Total users', 'users'], ['pending', 'Pending approval', 'hourglass'], ['brands', 'Brands', 'briefcase'], ['creators', 'Creators', 'video'],
             ['campaigns', 'Campaigns', 'megaphone'], ['premium', 'Premium', 'crown'], ['emails_failed', 'Failed emails', 'mail-x']]
            .map(([k, l, ic]) => `<div class="kpi ${k === 'pending' && stats[k] ? 'amber' : ''}"><div class="kpi-ico"><i data-lucide="${ic}"></i></div><small>${l}</small><b>${stats[k] ?? 0}</b></div>`).join('')}
        </div>
        <div class="panel">
          <div class="panel-head"><h3>Users</h3><span class="muted sm-text">Account approval is <b>${approvalOn ? 'ON' : 'OFF'}</b> (setting <code>require_account_approval</code> below)</span></div>
          <div class="explore-bar">
            <div class="seg" id="admTabs">${STATUS_TABS.map(([v, l]) => `<button type="button" data-v="${v}" class="${adminFilter === v ? 'on' : ''}">${l}${v === 'pending' && stats.pending ? ` (${stats.pending})` : ''}</button>`).join('')}</div>
            <form class="search-sm" id="admSearch" role="search"><i data-lucide="search"></i><input id="admQ" value="${esc(adminSearch)}" placeholder="Search name or email" aria-label="Search users" /></form>
          </div>
          ${users.length ? `<div class="table-wrap"><table class="svc-table admin-table">
            <thead><tr><th>User</th><th>Type</th><th>Status</th><th>Registered</th><th>Actions</th></tr></thead>
            <tbody>${users.map(u => `<tr data-user="${u.id}" data-name="${esc(u.full_name || u.email)}">
              <td><b>${esc(u.full_name || '(no name)')}</b>${u.is_admin ? ' <span class="status-pill ok">admin</span>' : ''}<small>${esc(u.email)}${u.email_confirmed_at ? '' : ' · email not verified'}</small></td>
              <td>${esc(u.role || '—')}</td>
              <td><span class="status-pill ${u.status === 'active' ? 'ok' : ''}">${esc(u.status)}</span>${u.status_reason ? `<small>${esc(u.status_reason)}</small>` : ''}</td>
              <td>${new Date(u.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              <td class="adm-actions">${u.is_admin ? '<small class="muted">admin</small>' : [
                u.status !== 'active' ? `<button class="btn primary sm" data-set-status="active">${u.status === 'pending' ? 'Approve' : 'Reactivate'}</button>` : '',
                u.status === 'pending' ? '<button class="btn soft sm" data-set-status="rejected">Reject</button>' : '',
                u.status === 'active' ? '<button class="btn soft sm" data-set-status="suspended">Suspend</button>' : '',
              ].join('')}</td></tr>`).join('')}</tbody></table></div>`
            : `<div class="empty-inline"><i data-lucide="users"></i><p>No ${adminFilter || ''} users${adminSearch ? ' match this search' : ''}.</p></div>`}
        </div>`;
      icons();
    } catch (err) {
      const missing = /not set up|could not find|schema cache/i.test(err.message);
      box.innerHTML = `<div class="panel"><h3>Users &amp; approvals</h3><p class="form-msg">${missing
        ? 'The user-management functions are not in the database yet. Run <code>supabase/migrations/20261010000200_account_approval.sql</code> in the Supabase SQL Editor, then reload.'
        : esc(err.message)}</p></div>`;
    }
  }

  function wireAdminUsers() {
    const box = $('#adminUsers');
    if (!box) return;
    drawAdminUsers();
    box.addEventListener('click', async e => {
      const tab = e.target.closest('#admTabs [data-v]');
      if (tab) { adminFilter = tab.dataset.v; return drawAdminUsers(); }
      const btn = e.target.closest('[data-set-status]');
      if (!btn) return;
      const row = btn.closest('[data-user]'), status = btn.dataset.setStatus;
      let reason = null;
      if (status !== 'active') {
        reason = prompt(`${status === 'rejected' ? 'Reject' : 'Suspend'} ${row.dataset.name}?\nOptional reason (included in the email to the user):`, '');
        if (reason === null) return;  // cancelled
      }
      setBusy(btn, true, '…');
      try {
        await B.db.adminSetUserStatus(row.dataset.user, status, reason);
        toast(`${row.dataset.name}: ${status === 'active' ? 'approved' : status}. The user has been notified.`);
        drawAdminUsers();
      } catch (err) { setBusy(btn, false); toast(err.message, 'err'); }
    });
    box.addEventListener('submit', e => { if (e.target.id === 'admSearch') { e.preventDefault(); adminSearch = $('#admQ').value.trim(); drawAdminUsers(); } });
  }

  async function wireAdmin() {
    wireAdminUsers();
    AdminAnalytics.wire();
    if (!$('#adminBox')) return;
    try {
      const [pl, lim, set] = await Promise.all([B.db.plans(), B.db.limits(), B.db.settings()]);
      $('#adminBox').innerHTML = `
        <div class="panel"><h3>Usage limits</h3><p class="muted sm-text">Leave the limit empty for unlimited.</p>
          <div class="table-wrap"><table class="svc-table admin-table"><thead><tr><th>Plan</th><th>Feature</th><th>Limit</th><th>Period</th><th></th></tr></thead><tbody>
          ${lim.map(l => `<tr data-limit="${l.tier}|${l.feature}"><td>${l.tier}</td><td>${FEATURE_LABEL[l.feature]}</td>
            <td><input type="number" min="0" value="${l.limit_value ?? ''}" placeholder="unlimited" data-f="limit_value" /></td>
            <td><select data-f="period">${['day', 'month', 'lifetime'].map(p => `<option ${l.period === p ? 'selected' : ''}>${p}</option>`).join('')}</select></td>
            <td><button class="btn soft sm" data-save-limit>Save</button></td></tr>`).join('')}</tbody></table></div></div>
        <div class="panel"><h3>Plans</h3><div class="admin-plans">
          ${pl.map(p => `<form class="admin-plan" data-plan="${p.id}" novalidate>
            <div class="row-2"><div class="field"><label class="field-label">Name</label><input data-f="name" value="${esc(p.name)}" /></div>
            <div class="field"><label class="field-label">Price (₹)</label><input data-f="price_inr" type="number" min="0" value="${p.price_inr}" /></div></div>
            <div class="field"><label class="field-label">Description</label><input data-f="description" value="${esc(p.description)}" /></div>
            ${p.tier === 'premium' ? `<div class="field"><label class="field-label">Razorpay plan ID <span class="opt">from Razorpay &gt; Subscriptions &gt; Plans</span></label><input data-f="razorpay_plan_id" value="${esc(p.razorpay_plan_id || '')}" placeholder="plan_XXXXXXXXXXXX" /></div>` : ''}
            <div class="field"><label class="field-label">Features <span class="opt">one per line</span></label><textarea data-f="features" rows="4">${esc(p.features.join('\n'))}</textarea></div>
            <label class="switch"><input type="checkbox" data-f="is_active" ${p.is_active ? 'checked' : ''} /><span></span>Active</label>
            <button class="btn primary sm">Save ${esc(p.name)}</button></form>`).join('')}
          </div><p class="muted sm-text">The price shown here is for display. The amount charged comes from the Razorpay plan, so keep them in sync.</p></div>
        <div class="panel"><h3>Feature &amp; billing settings</h3>
          ${set.map(s => `<div class="admin-setting" data-setting="${s.key}"><div><b>${esc(s.key)}</b><small class="muted">${esc(s.description)}</small></div>
            ${typeof s.value === 'boolean' ? `<label class="switch"><input type="checkbox" ${s.value ? 'checked' : ''} /><span></span></label>` : `<input value="${esc(JSON.stringify(s.value))}" /><button class="btn soft sm">Save</button>`}</div>`).join('')}</div>`;
      icons();
      const box = $('#adminBox');
      box.addEventListener('click', async e => {
        const b = e.target.closest('[data-save-limit]'); if (!b) return;
        const tr = b.closest('tr'), [tier, feature] = tr.dataset.limit.split('|');
        const val = tr.querySelector('[data-f=limit_value]').value;
        setBusy(b, true, '…');
        try { await B.db.adminUpdateLimit(tier, feature, { limit_value: val === '' ? null : Math.max(0, +val), period: tr.querySelector('[data-f=period]').value }); toast('Limit saved'); }
        catch (err) { toast(err.message, 'err'); }
        setBusy(b, false);
      });
      box.addEventListener('submit', async e => {
        const f = e.target.closest('[data-plan]'); if (!f) return;
        e.preventDefault();
        const val = k => f.querySelector(`[data-f=${k}]`);
        const patch = { name: val('name').value.trim(), description: val('description').value.trim(), price_inr: Math.max(0, +val('price_inr').value || 0),
          features: val('features').value.split('\n').map(s => s.trim()).filter(Boolean), is_active: val('is_active').checked };
        if (val('razorpay_plan_id')) {
          const rid = val('razorpay_plan_id').value.trim();
          if (rid && !/^plan_[A-Za-z0-9]+$/.test(rid)) return toast('Razorpay plan IDs look like plan_XXXXXXXX', 'err');
          patch.razorpay_plan_id = rid || null;
        }
        const btn = f.querySelector('button'); setBusy(btn, true, 'Saving…');
        try { await B.db.adminUpdatePlan(f.dataset.plan, patch); plansCache = null; toast('Plan saved'); } catch (err) { toast(err.message, 'err'); }
        setBusy(btn, false);
      });
      box.addEventListener('change', async e => {
        const row = e.target.closest('[data-setting]'); if (!row || e.target.type !== 'checkbox') return;
        try { await B.db.adminUpdateSetting(row.dataset.setting, e.target.checked); toast('Setting saved'); } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'err'); }
      });
      $$('.admin-setting button', box).forEach(b => b.addEventListener('click', async () => {
        const row = b.closest('[data-setting]');
        let v; try { v = JSON.parse(row.querySelector('input').value); } catch { return toast('Enter valid JSON (e.g. 0.8 or "text")', 'err'); }
        try { await B.db.adminUpdateSetting(row.dataset.setting, v); toast('Setting saved'); } catch (err) { toast(err.message, 'err'); }
      }));
    } catch (err) { $('#adminBox').innerHTML = `<p class="form-msg">${esc(err.message)}</p>`; }
  }

  /* ---------- gate for protected actions ---------- */
  // Resolves true when the user may proceed; otherwise explains why and offers the next step.
  function gate({ role, why = 'continue' } = {}) {
    if (B.initializing) { toast('Still connecting to accounts. Please try again in a moment.'); return false; }
    if (!B.configured) {
      openModal(`<div class="modal-head"><h2><i data-lucide="plug-zap"></i>Accounts not connected</h2><button class="icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button></div>
        <p class="muted">Signing in, saving and payments need the Supabase backend, which isn't configured on this copy of the site yet (see SETUP.md).</p>
        <div class="modal-foot"><button class="btn primary" data-close>OK</button></div>`).onclick = e => { if (e.target.closest('[data-close]')) closeModal(); };
      return false;
    }
    if (!B.session) {
      // Sign-in happens once at the entrance; if the session expired, go back there (no per-feature prompts).
      App.setNext(location.hash);
      go('#/login');
      return false;
    }
    if (!B.verified) { go('#/verify'); return false; }
    if (B.accountStatus !== 'active') { go('#/dashboard'); toast('Your account is not active yet, so this action is unavailable.', 'err'); return false; }
    if (role && B.profile?.role !== role) {
      if (!B.profile?.role) { toast('Choose your account type first'); go('#/onboarding'); return false; }
      openModal(`<div class="modal-head"><h2><i data-lucide="user-round-x"></i>${role === 'brand' ? 'Brand' : 'Creator'} accounts only</h2><button class="icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button></div>
        <p class="muted">You're signed in with a ${B.profile.role} account. Only ${role} accounts can ${esc(why)}.</p>
        <div class="modal-foot"><button class="btn primary" data-close>OK</button></div>`).onclick = e => { if (e.target.closest('[data-close]')) closeModal(); };
      return false;
    }
    return true;
  }

  // Signed in, but an administrator hasn't activated the account (approval workflow)
  const accountStatusScreen = () => {
    const s = B.accountStatus, reason = B.profile?.status_reason;
    const copy = {
      pending: ['hourglass', 'Your account is awaiting approval', 'Your email is verified. An administrator will review your registration, and we\'ll email you when it\'s approved. You can still browse creators in the meantime.'],
      rejected: ['circle-x', 'Your registration was not approved', 'An administrator reviewed your registration and did not approve it.'],
      suspended: ['shield-alert', 'Your account is suspended', 'Marketplace actions are disabled for this account.'],
    }[s] || ['info', 'Account not active', ''];
    return shell('Account status', copy[0], copy[1], copy[2], `
      <div class="panel setup-box">
        ${reason ? `<p><b>Reason:</b> ${esc(reason)}</p>` : ''}
        <p class="muted">Signed in as ${esc(B.user?.email || '')}. If you think this is a mistake, contact support.</p>
        <div class="head-actions"><button class="btn primary" onclick="location.reload()"><i data-lucide="refresh-cw"></i>Check again</button><a class="btn outline" href="#/explore">Browse creators</a><button class="btn soft" data-signout><i data-lucide="log-out"></i>Sign out</button></div>
      </div>`);
  };

  // Signed in successfully, but the Supabase project has no CreatorVerse tables yet
  const dbSetupPending = () => shell('Signed in', 'badge-check', `You're signed in${B.user?.email ? ` as ${esc(B.user.email)}` : ''}`,
    'Your account works, but this Supabase project doesn\'t have the CreatorVerse database tables yet, so your profile and dashboard can\'t load.', `
    <div class="panel setup-box">
      <h3>For the site owner</h3>
      <ol><li>Open your project in the Supabase dashboard and go to <b>SQL Editor</b>.</li>
      <li>Run the five files in <code>supabase/migrations/</code> in name order: <code>…0000_creatorverse_core</code>, <code>…0100_email_dispatch</code>,
        <code>…0200_account_approval</code>, <code>…0300_network_and_analytics</code>, <code>…0400_emails_campaigns_reports</code>.</li>
      <li>Reload this page.</li></ol>
      <div class="head-actions"><button class="btn primary" onclick="location.reload()"><i data-lucide="refresh-cw"></i>Check again</button><button class="btn outline" data-signout><i data-lucide="log-out"></i>Sign out</button></div>
    </div>`);

  const views = {
    login: [renderLogin, wireLogin], signup: [renderSignup, wireSignup], join: [renderSignup, wireSignup], verify: [renderVerify, wireVerify],
    forgot: [renderForgot, wireForgot], reset: [renderReset, wireReset], onboarding: [renderOnboarding, wireOnboarding], account: [renderAccount, wireAccount],
    notifications: [renderNotifications, wireNotifications], pricing: [renderPricing, wirePricing], billing: [renderBilling, wireBilling],
    payment: [renderPayment, wirePayment], admin: [renderAdmin, wireAdmin],
  };
  const AUTH_REQUIRED = new Set(['onboarding', 'account', 'notifications', 'billing', 'admin']);

  return { views, AUTH_REQUIRED, dbSetupPending, accountStatusScreen, gate, meter, upgradeDialog, usageMeters, notifItem, setupRequired, plans };
})();
