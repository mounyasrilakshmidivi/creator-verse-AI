/* Admin: login & user analytics (metrics, charts, written analysis, records table, Excel export)
   and Email Campaigns. Every number comes from admin-only database functions
   (admin_login_report, admin_login_events, admin_*campaign*); nothing here is sample data. */
const AdminAnalytics = (() => {
  const B = Backend;
  const C = { s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', grid: '#e1e0d9', axis: '#c3c2b7', muted: '#898781', ink: '#11172a', ink2: '#52514e' };
  const DAY = 86400000;
  const st = { preset: 30, from: null, to: null, role: '', status: '', user: '', page: 0, report: null };
  const pageSize = 25;

  /* ---------- formulas (zero-safe) ---------- */
  const pct = (num, den) => (den > 0 ? (num / den) * 100 : null);
  const fmtPct = v => (v == null ? 'N/A' : `${v.toFixed(1)}%`);
  const n = v => Number(v || 0).toLocaleString('en-IN');
  const dayLabel = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  // Period boundaries are midnights in the report time zone (the same zone the database uses for daily buckets),
  // so the result doesn't depend on the admin's computer clock settings.
  let tz = 'Asia/Kolkata';
  const ymdIn = (d, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const addDays = (ymd, k) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + k)).toISOString().slice(0, 10);
  function midnight(ymd) {
    const guess = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
    return new Date(guess - (zoned(new Date(guess).toISOString(), tz) - guess)).toISOString();
  }
  function range() {
    if (st.preset === 'custom' && st.from && st.to) return { from: midnight(st.from), to: midnight(addDays(st.to, 1)) };
    const tomorrow = addDays(ymdIn(new Date(), tz), 1);
    return { from: midnight(addDays(tomorrow, -st.preset)), to: midnight(tomorrow) };
  }

  /* ======================================================
     LAYOUT
     ====================================================== */
  function render() {
    const today = new Date().toISOString().slice(0, 10);
    return `
      <section class="panel analytics" id="anaRoot">
        <div class="panel-head"><h3>Login &amp; user analytics</h3>
          <button class="btn primary" id="anaExcel"><i data-lucide="file-spreadsheet"></i>Download Login Excel</button></div>
        <form class="ana-filters" id="anaFilters">
          <div class="seg" id="anaPreset">${[[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], ['custom', 'Custom']].map(([v, l]) => `<button type="button" data-v="${v}" class="${st.preset == v ? 'on' : ''}">${l}</button>`).join('')}</div>
          <span class="ana-custom" ${st.preset === 'custom' ? '' : 'hidden'}>
            <input type="date" id="anaFrom" max="${today}" value="${st.from || ''}" aria-label="From date" />
            <input type="date" id="anaTo" max="${today}" value="${st.to || ''}" aria-label="To date" /></span>
          <select id="anaRole" aria-label="Role"><option value="">All roles</option><option value="creator" ${st.role === 'creator' ? 'selected' : ''}>Creators</option><option value="brand" ${st.role === 'brand' ? 'selected' : ''}>Brands</option></select>
          <select id="anaStatus" aria-label="Login status"><option value="">All statuses</option><option value="success" ${st.status === 'success' ? 'selected' : ''}>Successful</option><option value="failure" ${st.status === 'failure' ? 'selected' : ''}>Failed</option></select>
          <input id="anaUser" value="${esc(st.user)}" placeholder="User name, email or ID" aria-label="User" />
          <button class="btn soft" id="anaApply"><i data-lucide="filter"></i>Apply</button>
        </form>
        <p class="muted sm-text">Role filter applies to everything; status and user filters apply to the login records. Times are shown in <span id="anaTz">the report time zone</span>.
          Failed attempts are reported by the browser after Supabase rejects a sign-in (no passwords are ever recorded).</p>
        <div id="anaBody"><div class="skeleton" style="height:420px"></div></div>
      </section>
      <section class="panel" id="campRoot"><div class="skeleton" style="height:220px"></div></section>`;
  }

  /* ======================================================
     DATA + METRICS
     ====================================================== */
  async function load() {
    const body = $('#anaBody'); if (!body) return;
    body.innerHTML = '<div class="skeleton" style="height:420px"></div>';
    try {
      const { from, to } = range();
      if (new Date(to) <= new Date(from)) throw new Error('Choose an end date after the start date.');
      st.report = await B.db.adminLoginReport(from, to, st.role || null);
      $('#anaTz').textContent = st.report.timezone;
      if (st.report.timezone && st.report.timezone !== tz) { tz = st.report.timezone; return load(); }  // admin changed report_timezone
      body.innerHTML = view(st.report);
      icons();
      wireCharts();
      loadRecords();
    } catch (err) { body.innerHTML = `<p class="form-msg">${esc(err.message)}</p>`; }
  }

  function metrics(r) {
    const s = r.summary, attempts = s.successful_logins + s.failed_logins;
    return {
      ...s, attempts,
      successRate: pct(s.successful_logins, attempts),
      failureRate: pct(s.failed_logins, attempts),
      activation: pct(s.ever_logged_in, s.users_total),
      creatorShare: pct(s.creators, s.users_total),
      brandShare: pct(s.brands, s.users_total),
    };
  }

  function view(r) {
    const m = metrics(r);
    const tile = (label, value, sub = '') => `<div class="kpi"><small>${label}</small><b>${value}</b>${sub ? `<span class="kpi-sub">${sub}</span>` : ''}</div>`;
    return `
      <div class="kpi-grid ana-kpis">
        ${tile('Total registered users', n(m.users_total))}
        ${tile('Creators', n(m.creators), fmtPct(m.creatorShare) + ' of users')}
        ${tile('Brands', n(m.brands), fmtPct(m.brandShare) + ' of users')}
        ${tile('Successful logins', n(m.successful_logins), 'success rate ' + fmtPct(m.successRate))}
        ${tile('Failed login attempts', n(m.failed_logins), 'failure rate ' + fmtPct(m.failureRate))}
        ${tile('Unique active users', n(m.unique_users), 'signed in during the period')}
        ${tile('Never logged in', n(m.never_logged_in), 'activation rate ' + fmtPct(m.activation))}
        ${tile('New registrations', n(m.new_registrations), 'in the selected period')}
      </div>
      <div class="ana-insights panel"><h3><i data-lucide="sparkles"></i>Analysis</h3><ul>${insights(r, m).map(t => `<li>${t}</li>`).join('')}</ul></div>
      <div class="ana-charts">
        ${chartCard('Daily login trends', 'Successful and failed sign-ins per day', lineChart(r.daily, [['success', 'Successful', C.s1], ['failure', 'Failed', C.s2]]))}
        ${chartCard('Login success rate', `${n(m.attempts)} attempts in the period`, successTile(m))}
        ${chartCard('Daily active users', 'Distinct users with at least one successful sign-in', columnChart(r.daily.map(d => ({ label: dayLabel(d.day), value: d.active_users })), C.s1, 'active users'))}
        ${chartCard('User role distribution', 'Registered users by account type', hBars([{ label: 'Creators', value: m.creators }, { label: 'Brands', value: m.brands }, ...(m.no_role ? [{ label: 'Type not chosen', value: m.no_role }] : [])], m.users_total))}
        ${chartCard('Registration trends', 'New accounts per day', columnChart(r.daily.map(d => ({ label: dayLabel(d.day), value: d.registrations })), C.s1, 'registrations'))}
        ${chartCard('Collaboration activity', 'Member-to-member requests in the period', hBars([{ label: 'Sent', value: r.collaborations.sent }, { label: 'Accepted', value: r.collaborations.accepted }, { label: 'Declined', value: r.collaborations.declined }], null))}
      </div>
      <details class="ana-table"><summary>Daily data table</summary>${dailyTable(r)}</details>
      <h3 class="cd-h">Login records</h3>
      <div id="anaRecords"><div class="skeleton" style="height:200px"></div></div>`;
  }

  /* ---------- written analysis: only claims the data supports ---------- */
  function insights(r, m) {
    const out = [], p = r.previous;
    const curTotal = m.successful_logins, prevTotal = p.successful_logins;
    if (!r.history_available_from) {
      out.push('No login events have been recorded yet, so trends cannot be calculated.');
    } else if (!r.previous_period_complete) {
      out.push(`Login history starts on ${new Date(r.history_available_from).toLocaleDateString('en-IN', { dateStyle: 'medium' })}, so there is no complete previous period to compare against yet.`);
    } else if (prevTotal === 0 && curTotal === 0) {
      out.push('There were no successful logins in this period or the previous one.');
    } else {
      const change = pct(curTotal - prevTotal, prevTotal);
      out.push(change == null
        ? `Successful logins rose from 0 to ${n(curTotal)} compared with the previous ${dayCount(r)}-day period.`
        : `Successful logins ${curTotal >= prevTotal ? 'increased' : 'decreased'} by ${Math.abs(change).toFixed(1)}% (${n(prevTotal)} → ${n(curTotal)}) compared with the previous ${dayCount(r)}-day period.`);
      if (p.failed_logins || m.failed_logins) {
        out.push(m.failed_logins > p.failed_logins ? `Failed login attempts increased from ${n(p.failed_logins)} to ${n(m.failed_logins)}.`
          : m.failed_logins < p.failed_logins ? `Failed login attempts fell from ${n(p.failed_logins)} to ${n(m.failed_logins)}.`
          : `Failed login attempts were unchanged at ${n(m.failed_logins)}.`);
      }
    }
    const roles = r.roles.filter(x => x.success > 0).sort((a, b) => b.success - a.success);
    if (roles.length >= 2 && roles[0].success !== roles[1].success) out.push(`${cap(roles[0].role)}s had more login activity (${n(roles[0].success)} successful logins vs ${n(roles[1].success)} for ${roles[1].role}s).`);
    else if (roles.length >= 2) out.push('Creators and brands had the same number of successful logins.');
    else if (roles.length === 1 && !st.role) out.push(`Only ${roles[0].role}s signed in during this period.`);
    out.push(m.never_logged_in ? `${n(m.never_logged_in)} of ${n(m.users_total)} registered users have never logged in (activation rate ${fmtPct(m.activation)}).`
      : m.users_total ? 'Every registered user has logged in at least once (activation rate 100%).' : 'There are no registered users yet.');
    if (m.new_registrations) {
      const activated = r.users.filter(u => new Date(u.registered_at) >= new Date(r.from) && u.last_login).length;
      out.push(`${n(m.new_registrations)} new registrations in this period; ${n(activated)} of them (${fmtPct(pct(activated, m.new_registrations))}) have logged in since.`);
    } else out.push('No new registrations in this period.');
    const done = r.daily.filter(d => new Date(midnight(addDays(d.day, 1))) <= new Date());  // today is still in progress
    const active = done.filter(d => d.success > 0);
    if (active.length) {
      const hi = active.reduce((a, b) => (b.success > a.success ? b : a)), lo = done.reduce((a, b) => (b.success < a.success ? b : a));
      out.push(`Highest login activity: ${dayLabel(hi.day)} (${n(hi.success)} successful logins). Lowest: ${dayLabel(lo.day)} (${n(lo.success)}).`);
    }
    return out;
  }
  const dayCount = r => Math.round((new Date(r.to) - new Date(r.from)) / DAY);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* ======================================================
     CHARTS (inline SVG, validated palette, hover tooltips)
     ====================================================== */
  const chartCard = (title, sub, inner) => `<figure class="chart-card"><figcaption><b>${title}</b><small>${sub}</small></figcaption>${inner}</figure>`;
  const tip = text => ` data-tip="${esc(text)}"`;
  const niceMax = v => { if (v <= 4) return 4; const p = 10 ** Math.floor(Math.log10(v)); const s = [1, 2, 2.5, 5, 10].find(k => k * p >= v); return s * p; };

  function axes(w, h, pad, max, labels) {
    const ticks = [0, max / 2, max];
    const step = Math.max(1, Math.ceil(labels.length / 7));
    return ticks.map(t => { const y = h - pad.b - (t / max) * (h - pad.t - pad.b); return `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y}" y2="${y}" stroke="${t ? C.grid : C.axis}" stroke-width="1"/><text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" class="ax">${Number.isInteger(t) ? t : t.toFixed(1)}</text>`; }).join('')
      + labels.map((l, i) => (i % step === 0 || i === labels.length - 1 ? `<text x="${pad.l + (i + 0.5) * ((w - pad.l - pad.r) / labels.length)}" y="${h - 6}" text-anchor="middle" class="ax">${esc(l)}</text>` : '')).join('');
  }

  function lineChart(daily, series) {
    const w = 560, h = 220, pad = { l: 34, r: 12, t: 12, b: 26 };
    const labels = daily.map(d => dayLabel(d.day));
    const max = niceMax(Math.max(1, ...daily.flatMap(d => series.map(([k]) => d[k]))));
    const bw = (w - pad.l - pad.r) / Math.max(1, daily.length);
    const x = i => pad.l + (i + 0.5) * bw, y = v => h - pad.b - (v / max) * (h - pad.t - pad.b);
    const paths = series.map(([k, , color]) => `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${daily.map((d, i) => `${x(i)},${y(d[k])}`).join(' ')}"/>`
      + (daily.length <= 45 ? daily.map((d, i) => `<circle cx="${x(i)}" cy="${y(d[k])}" r="3" fill="${color}" stroke="#fff" stroke-width="1.5"/>`).join('') : '')).join('');
    const hits = daily.map((d, i) => `<rect x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${h - pad.t - pad.b}" fill="transparent" class="hit"${tip(`${dayLabel(d.day)}: ${series.map(([k, l]) => `${l} ${d[k]}`).join(' · ')}`)}/>`).join('');
    return `<div class="legend">${series.map(([, l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>
      <svg viewBox="0 0 ${w} ${h}" class="ana-svg" role="img" aria-label="Daily successful and failed logins">${axes(w, h, pad, max, labels)}${paths}${hits}</svg>`;
  }

  function columnChart(items, color, unit) {
    const w = 560, h = 200, pad = { l: 34, r: 12, t: 12, b: 26 };
    const max = niceMax(Math.max(1, ...items.map(i => i.value)));
    const bw = (w - pad.l - pad.r) / Math.max(1, items.length), barW = Math.max(2, Math.min(28, bw * 0.6));
    const bars = items.map((it, i) => {
      const bh = (it.value / max) * (h - pad.t - pad.b), x = pad.l + i * bw + (bw - barW) / 2, y = h - pad.b - bh;
      return `${it.value ? `<path d="M${x},${h - pad.b} V${y + Math.min(4, bh)} q0,-4 4,-4 h${barW - 8} q4,0 4,4 V${h - pad.b} Z" fill="${color}"/>` : ''}
        <rect x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${h - pad.t - pad.b}" fill="transparent" class="hit"${tip(`${it.label}: ${it.value} ${unit}`)}/>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" class="ana-svg" role="img" aria-label="${unit} per day">${axes(w, h, pad, max, items.map(i => i.label))}${bars}</svg>`;
  }

  function hBars(items, total) {
    const max = Math.max(1, ...items.map(i => i.value));
    return `<div class="hbars">${items.map(it => `<div class="hb-row"${tip(`${it.label}: ${it.value}${total ? ` (${fmtPct(pct(it.value, total))})` : ''}`)}>
      <span class="hb-label">${esc(it.label)}</span>
      <span class="hb-track"><span class="hb-bar" style="width:${(it.value / max) * 100}%;background:${C.s1}"></span></span>
      <b class="hb-val">${n(it.value)}${total ? ` <small>${fmtPct(pct(it.value, total))}</small>` : ''}</b></div>`).join('')}</div>`;
  }

  function successTile(m) {
    if (m.successRate == null) return '<div class="hero-stat"><b>N/A</b><small>No login attempts in this period</small></div>';
    return `<div class="hero-stat"><b>${fmtPct(m.successRate)}</b><small>successful = ${n(m.successful_logins)} ÷ ${n(m.attempts)} attempts × 100</small>
      <div class="split-bar"${tip(`Successful ${n(m.successful_logins)} · Failed ${n(m.failed_logins)}`)}><span style="width:${m.successRate}%;background:${C.s1}"></span><span style="width:${m.failureRate}%;background:${C.s2}"></span></div>
      <div class="legend"><span><i style="background:${C.s1}"></i>Successful ${fmtPct(m.successRate)}</span><span><i style="background:${C.s2}"></i>Failed ${fmtPct(m.failureRate)}</span></div></div>`;
  }

  function dailyTable(r) {
    return `<div class="table-wrap"><table class="svc-table"><thead><tr><th>Date</th><th>Successful</th><th>Failed</th><th>Success rate</th><th>Active users</th><th>Registrations</th></tr></thead>
      <tbody>${r.daily.map(d => `<tr><td>${dayLabel(d.day)}</td><td>${d.success}</td><td>${d.failure}</td><td>${fmtPct(pct(d.success, d.success + d.failure))}</td><td>${d.active_users}</td><td>${d.registrations}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // One shared tooltip for every chart mark
  function wireCharts() {
    let tipEl = $('#anaTip');
    if (!tipEl) { tipEl = Object.assign(document.createElement('div'), { id: 'anaTip', className: 'ana-tip', hidden: true }); document.body.append(tipEl); }
    const root = $('#anaBody');
    root.addEventListener('mousemove', e => {
      const t = e.target.closest('[data-tip]');
      if (!t) { tipEl.hidden = true; return; }
      tipEl.textContent = t.dataset.tip; tipEl.hidden = false;
      tipEl.style.left = Math.min(innerWidth - tipEl.offsetWidth - 8, e.clientX + 12) + 'px'; tipEl.style.top = (e.clientY + 14) + 'px';
    });
    root.addEventListener('mouseleave', () => { tipEl.hidden = true; });
  }

  /* ======================================================
     LOGIN RECORDS TABLE (server-side pagination)
     ====================================================== */
  const recordFilters = () => ({ ...range(), role: st.role || null, status: st.status || null, search: st.user || null });
  const fmtDT = (iso, tz, part) => new Date(iso).toLocaleString('en-IN', part === 'date' ? { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' } : { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  async function loadRecords() {
    const box = $('#anaRecords'); if (!box) return;
    try {
      const rows = await B.db.adminLoginEvents({ ...recordFilters(), limit: pageSize, offset: st.page * pageSize });
      const total = rows[0] ? Number(rows[0].total_count) : 0, tz = st.report?.timezone || 'UTC';
      box.innerHTML = rows.length ? `<div class="table-wrap"><table class="svc-table admin-table"><thead><tr><th>Date</th><th>Time</th><th>User</th><th>Role</th><th>Status</th><th>Method</th></tr></thead>
        <tbody>${rows.map(e => `<tr><td>${fmtDT(e.occurred_at, tz, 'date')}</td><td>${fmtDT(e.occurred_at, tz, 'time')}</td>
          <td><b>${esc(e.user_name || '(no account)')}</b><small>${esc(e.email || '')}</small></td><td>${esc(e.user_role || '—')}</td>
          <td><span class="status-pill ${e.status === 'success' ? 'ok' : 'bad'}">${e.status === 'success' ? 'Successful' : 'Failed'}</span>${e.failure_reason ? `<small>${esc(e.failure_reason.replace(/_/g, ' '))}</small>` : ''}</td>
          <td>${esc(e.method)}${e.source === 'client_report' ? '<small>browser report</small>' : ''}</td></tr>`).join('')}</tbody></table></div>
        <div class="pager"><span class="muted sm-text">${st.page * pageSize + 1}–${st.page * pageSize + rows.length} of ${n(total)}</span>
          <button class="btn soft sm" data-page="-1" ${st.page ? '' : 'disabled'}>Previous</button><button class="btn soft sm" data-page="1" ${(st.page + 1) * pageSize >= total ? 'disabled' : ''}>Next</button></div>`
        : '<div class="empty-inline"><i data-lucide="list-x"></i><p>No login events match these filters.</p></div>';
      icons();
    } catch (err) { box.innerHTML = `<p class="form-msg">${esc(err.message)}</p>`; }
  }

  /* ======================================================
     EXCEL EXPORT: CreatorVerse_Login_Analytics.xlsx (4 sheets, built in the admin's browser from admin-only data)
     ====================================================== */
  // Excel has no time zones: write the report-zone wall-clock time so the sheet shows the same times as the dashboard.
  function zoned(iso, tz) {
    if (!iso) return null;
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso)).map(x => [x.type, x.value]));
    return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
  }

  async function exportExcel(btn) {
    setBusy(btn, true, 'Building Excel…');
    try {
      if (!window.ExcelJS) await loadScript('js/vendor/exceljs-4.4.0.min.js');
      const f = recordFilters();
      const report = await B.db.adminLoginReport(f.from, f.to, f.role);
      const tz = report.timezone;
      const events = [];
      for (let off = 0; off < 100000; off += 1000) {
        const batch = await B.db.adminLoginEvents({ ...f, limit: 1000, offset: off });
        events.push(...batch);
        if (batch.length < 1000) break;
      }
      const m = metrics(report);
      const wb = new ExcelJS.Workbook();
      wb.creator = 'CreatorVerse AI'; wb.created = new Date();
      const periodText = `${new Date(report.from).toLocaleDateString('en-IN', { timeZone: tz, dateStyle: 'medium' })} – ${new Date(new Date(report.to).getTime() - 1).toLocaleDateString('en-IN', { timeZone: tz, dateStyle: 'medium' })} (${tz})`;
      const head = (ws, title, cols) => {
        ws.addRow([title]).font = { bold: true, size: 14, color: { argb: 'FF8138E8' } };
        ws.addRow([`Period: ${periodText} · Role: ${f.role || 'all'} · Generated ${new Date().toLocaleString('en-IN', { timeZone: tz })}`]).font = { color: { argb: 'FF647084' } };
        ws.addRow(['CONFIDENTIAL: administrator use only. Contains personal data; do not share or publish.']).font = { italic: true, color: { argb: 'FFB42318' } };
        ws.addRow([]);
        const hr = ws.addRow(cols.map(c => c.header));
        hr.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8138E8' } }; c.alignment = { vertical: 'middle' }; });
        cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; if (c.fmt) ws.getColumn(i + 1).numFmt = c.fmt; });
        ws.views = [{ state: 'frozen', ySplit: 5 }];
        return hr.number;
      };
      const finish = (ws, headerRow, nCols) => { ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, ws.rowCount), column: nCols } }; };

      // Sheet 1: Login Records
      const s1 = wb.addWorksheet('Login Records');
      const c1 = [{ header: 'Login Event ID', width: 38 }, { header: 'User ID', width: 38 }, { header: 'User Name', width: 22 }, { header: 'Registered Email Address', width: 30 },
        { header: 'User Role', width: 11 }, { header: 'Login Date', width: 13, fmt: 'dd-mmm-yyyy' }, { header: 'Login Time', width: 11, fmt: 'hh:mm:ss' },
        { header: 'Login Status', width: 13 }, { header: 'Failure Reason', width: 20 }, { header: 'Login Method', width: 13 }, { header: 'Recorded By', width: 16 },
        { header: 'Account Created', width: 18, fmt: 'dd-mmm-yyyy hh:mm' }, { header: 'Last Activity', width: 18, fmt: 'dd-mmm-yyyy hh:mm' }];
      const h1 = head(s1, 'CreatorVerse AI · Login Records', c1);
      if (f.status || f.search) s1.getRow(2).getCell(1).value += ` · Records filtered by status: ${f.status || 'all'}, user: ${f.search || 'all'}`;
      events.forEach(e => {
        const z = zoned(e.occurred_at, tz);
        s1.addRow([e.event_id, e.user_id || '', e.user_name || '', e.email || '', e.user_role || '', z, z, e.status === 'success' ? 'Successful' : 'Failed',
          e.failure_reason ? e.failure_reason.replace(/_/g, ' ') : '', e.method, e.source === 'auth' ? 'Supabase Auth' : 'Browser report', zoned(e.account_created_at, tz), zoned(e.last_activity, tz)]);
      });
      finish(s1, h1, c1.length);

      // Sheet 2: User Summary
      const s2 = wb.addWorksheet('User Summary');
      s2.addRow(['CreatorVerse AI · User Summary']).font = { bold: true, size: 14, color: { argb: 'FF8138E8' } };
      s2.addRow([`Period: ${periodText} · Role: ${f.role || 'all'}`]).font = { color: { argb: 'FF647084' } };
      s2.addRow([]);
      [['Total registered users', m.users_total], ['Total creators', m.creators], ['Total brands', m.brands], ['Successful logins', m.successful_logins],
        ['Failed login attempts', m.failed_logins], ['Unique users who logged in (period)', m.unique_users], ['Users who have never logged in', m.never_logged_in],
        ['New registrations (period)', m.new_registrations], ['Login success rate', m.successRate == null ? 'N/A' : m.successRate / 100],
        ['Activation rate (ever logged in ÷ registered)', m.activation == null ? 'N/A' : m.activation / 100]]
        .forEach(([k, v]) => { const r = s2.addRow([k, v]); r.getCell(1).font = { bold: true }; if (typeof v === 'number' && v <= 1 && /rate/.test(k)) r.getCell(2).numFmt = '0.0%'; });
      s2.getColumn(1).width = 44; s2.getColumn(2).width = 16;
      s2.addRow([]);
      const c2 = [{ header: 'User ID', width: 38 }, { header: 'User Name', width: 22 }, { header: 'Registered Email Address', width: 30 }, { header: 'User Role', width: 11 },
        { header: 'Registered On', width: 18, fmt: 'dd-mmm-yyyy hh:mm' }, { header: 'Last Login', width: 18, fmt: 'dd-mmm-yyyy hh:mm' }, { header: 'Last Activity', width: 18, fmt: 'dd-mmm-yyyy hh:mm' },
        { header: 'Logins in Period', width: 16 }, { header: 'Failed in Period', width: 15 }, { header: 'Never Logged In', width: 15 }];
      const hr2 = s2.addRow(c2.map(c => c.header));
      hr2.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8138E8' } }; });
      c2.forEach((c, i) => { if (i > 1) s2.getColumn(i + 1).width = Math.max(s2.getColumn(i + 1).width || 0, c.width); });
      report.users.forEach(u => {
        const r = s2.addRow([u.user_id, u.name || '', u.email, u.role || '', zoned(u.registered_at, tz), zoned(u.last_login, tz), zoned(u.last_activity, tz), u.logins_in_period, u.failed_in_period, u.last_login ? 'No' : 'Yes']);
        [5, 6, 7].forEach(i => { r.getCell(i).numFmt = 'dd-mmm-yyyy hh:mm'; });
      });
      s2.autoFilter = { from: { row: hr2.number, column: 1 }, to: { row: Math.max(hr2.number, s2.rowCount), column: c2.length } };

      // Sheet 3: Daily Analytics
      const s3 = wb.addWorksheet('Daily Analytics');
      const c3 = [{ header: 'Date', width: 14, fmt: 'dd-mmm-yyyy' }, { header: 'Successful Logins', width: 18 }, { header: 'Failed Attempts', width: 16 },
        { header: 'Unique Active Users', width: 20 }, { header: 'New Registrations', width: 18 }, { header: 'Success Rate', width: 13, fmt: '0.0%' }];
      const h3 = head(s3, 'CreatorVerse AI · Daily Analytics', c3);
      report.daily.forEach(d => s3.addRow([new Date(d.day + 'T00:00:00Z'), d.success, d.failure, d.active_users, d.registrations, d.success + d.failure ? d.success / (d.success + d.failure) : 'N/A']));
      finish(s3, h3, c3.length);

      // Sheet 4: Role Analysis
      const s4 = wb.addWorksheet('Role Analysis');
      const c4 = [{ header: 'User Role', width: 14 }, { header: 'Registered Users', width: 17 }, { header: 'Successful Logins', width: 18 }, { header: 'Failed Attempts', width: 16 },
        { header: 'Unique Active Users', width: 20 }, { header: 'Success Rate', width: 13, fmt: '0.0%' }, { header: 'Share of Successful Logins', width: 25, fmt: '0.0%' }];
      const h4 = head(s4, 'CreatorVerse AI · Role Analysis', c4);
      const totalOk = report.roles.reduce((s, x) => s + x.success, 0);
      report.roles.forEach(x => s4.addRow([cap(x.role), x.registered, x.success, x.failure, x.unique_users,
        x.success + x.failure ? x.success / (x.success + x.failure) : 'N/A', totalOk ? x.success / totalOk : 'N/A']));
      finish(s4, h4, c4.length);

      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      Object.assign(document.createElement('a'), { href: url, download: 'CreatorVerse_Login_Analytics.xlsx' }).click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast(`Excel downloaded: ${n(events.length)} login records, ${n(report.users.length)} users, ${report.daily.length} days.`);
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(btn, false); }
  }

  /* ======================================================
     EMAIL CAMPAIGNS
     ====================================================== */
  const camp = { id: null, audience: 'all', subject: '', body: '' };
  async function drawCampaigns() {
    const root = $('#campRoot'); if (!root) return;
    try {
      const [aud, list] = await Promise.all([B.db.adminCampaignAudience(camp.audience), B.db.adminCampaigns()]);
      root.innerHTML = `
        <div class="panel-head"><h3>Email Campaigns</h3><span class="muted sm-text">Sent only to verified, active users who opted in to news emails. Each person gets their own email with a one-click unsubscribe link.</span></div>
        <form id="ecForm" class="ec-form" novalidate>
          <div class="row-2">
            <div class="field"><label class="field-label" for="ecAudience">Recipients</label>
              <select id="ecAudience">${[['all', 'All eligible users'], ['creator', 'Creators only'], ['brand', 'Brands only']].map(([v, l]) => `<option value="${v}" ${camp.audience === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div class="field"><label class="field-label">Eligible recipients</label>
              <p class="ec-count"><b>${n(aud.eligible)}</b> of ${n(aud.registered)} registered <small class="muted">(${n(aud.not_opted_in)} not opted in to news emails)</small></p></div>
          </div>
          <div class="field"><label class="field-label" for="ecSubject">Subject</label><input id="ecSubject" maxlength="150" value="${esc(camp.subject)}" /></div>
          <div class="field"><label class="field-label" for="ecBody">Message <span class="opt">plain text; blank line = new paragraph</span></label><textarea id="ecBody" rows="7" maxlength="10000">${esc(camp.body)}</textarea></div>
          <p class="form-msg" id="ecErr" role="alert" hidden></p>
          <div class="head-actions">
            <button type="button" class="btn soft" data-ec="preview"><i data-lucide="eye"></i>Preview</button>
            <button type="button" class="btn soft" data-ec="test"><i data-lucide="send"></i>Send test to me</button>
            <button type="button" class="btn primary" data-ec="launch" ${aud.eligible ? '' : 'disabled title="No eligible recipients"'}><i data-lucide="rocket"></i>Launch campaign…</button>
          </div>
        </form>
        <h3 class="cd-h">Campaign history</h3>
        ${list.length ? `<div class="table-wrap"><table class="svc-table admin-table"><thead><tr><th>Campaign</th><th>Audience</th><th>Status</th><th>Recipients</th><th>Queued</th><th>Sent</th><th>Delivered</th><th>Failed</th><th>Bounced</th><th>Skipped</th></tr></thead>
          <tbody>${list.map(c => `<tr><td><b>${esc(c.subject)}</b><small>${c.launched_at ? 'Launched ' + new Date(c.launched_at).toLocaleString('en-IN') : 'Draft' + (c.test_sent_at ? ' · test sent' : '')}</small></td>
            <td>${esc(c.audience)}</td><td><span class="status-pill ${c.status === 'queued' ? 'ok' : ''}">${c.status === 'queued' ? 'launched' : esc(c.status)}</span></td>
            <td>${n(c.recipient_count)}</td><td>${n(c.queued)}</td><td>${n(c.sent)}</td><td>${n(c.delivered)}</td><td>${n(c.failed)}</td><td>${n(c.bounced)}</td><td>${n(c.skipped)}</td></tr>`).join('')}</tbody></table></div>
          <p class="muted sm-text">"Delivered" and "Bounced" update when the Resend webhook is configured. Until an email provider is connected, launched emails stay queued.</p>`
          : '<div class="empty-inline"><i data-lucide="mail"></i><p>No campaigns yet.</p></div>'}`;
      icons();
    } catch (err) { root.innerHTML = `<h3>Email Campaigns</h3><p class="form-msg">${esc(err.message)}</p>`; }
  }

  function readCampaign() {
    camp.audience = $('#ecAudience').value; camp.subject = $('#ecSubject').value.trim(); camp.body = $('#ecBody').value.trim();
    return validateAll([
      [$('#ecSubject'), () => (camp.subject.length < 3 ? 'Enter a subject (at least 3 characters).' : '')],
      [$('#ecBody'), () => (camp.body.length < 10 ? 'Write a message of at least 10 characters.' : '')],
    ]);
  }
  async function saveDraft() { camp.id = await B.db.adminSaveCampaign(camp.id, camp.audience, camp.subject, camp.body); }

  function previewHtml() {
    return `<div class="email-preview"><div class="ep-head"><b>CreatorVerse AI</b><small>Creators × Brands × AI</small></div>
      <div class="ep-body"><h2>${esc(camp.subject)}</h2>${camp.body.split(/\n{2,}/).map(p => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('')}
      <span class="btn primary sm">Visit CreatorVerse AI</span></div>
      <div class="ep-foot">You are receiving this because you opted in to CreatorVerse AI updates. <u>Unsubscribe</u> with one click.</div></div>`;
  }

  async function onCampaignClick(e) {
    const b = e.target.closest('[data-ec]'); if (!b) return;
    const err = $('#ecErr'); err.hidden = true;
    if (!readCampaign()) return;
    const action = b.dataset.ec;
    if (action === 'preview') {
      openModal(`<div class="modal-head"><h2><i data-lucide="eye"></i>Email preview</h2><button class="icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button></div>
        <p class="muted sm-text">To: each recipient individually · Subject: <b>${esc(camp.subject)}</b></p>${previewHtml()}`).onclick = ev => { if (ev.target.closest('[data-close]')) closeModal(); };
      return;
    }
    setBusy(b, true, action === 'test' ? 'Queuing test…' : 'Preparing…');
    try {
      await saveDraft();
      if (action === 'test') {
        await B.db.adminSendCampaignTest(camp.id);
        toast(`Test email queued to ${B.user.email}. It is sent once the email provider is configured.`);
        setBusy(b, false);
        return drawCampaigns();
      }
      const aud = await B.db.adminCampaignAudience(camp.audience);
      setBusy(b, false);
      const body = openModal(`<div class="modal-head"><h2><i data-lucide="rocket"></i>Launch campaign?</h2><button class="icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button></div>
        <p>This will email <b>${n(aud.eligible)}</b> opted-in ${camp.audience === 'all' ? 'users' : camp.audience + 's'} individually with the subject <b>${esc(camp.subject)}</b>. It cannot be undone.</p>
        <div class="field"><label class="field-label" for="ecConfirm">Type <b>SEND</b> to confirm</label><input id="ecConfirm" autocomplete="off" /></div>
        <div class="modal-foot"><button class="btn soft" data-close>Cancel</button><button class="btn primary" id="ecGo">Launch campaign</button></div>`);
      body.onclick = async ev => {
        if (ev.target.closest('[data-close]')) return closeModal();
        const go = ev.target.closest('#ecGo'); if (!go) return;
        if ($('#ecConfirm').value.trim() !== 'SEND') return setFieldError($('#ecConfirm'), 'Type SEND exactly to confirm.');
        setBusy(go, true, 'Queuing…');
        try {
          const count = await B.db.adminLaunchCampaign(camp.id, 'SEND');
          closeModal();
          toast(`Campaign queued for ${n(count)} recipients.`);
          Object.assign(camp, { id: null, subject: '', body: '' });
          drawCampaigns();
        } catch (ex) { setBusy(go, false); toast(ex.message, 'err'); }
      };
    } catch (ex) { setBusy(b, false); err.textContent = ex.message; err.hidden = false; }
  }

  /* ======================================================
     WIRING
     ====================================================== */
  function wire() {
    const root = $('#anaRoot'); if (!root) return;
    load();
    drawCampaigns();
    $('#anaPreset').addEventListener('click', e => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      st.preset = b.dataset.v === 'custom' ? 'custom' : +b.dataset.v;
      $$('#anaPreset button').forEach(x => x.classList.toggle('on', x === b));
      root.querySelector('.ana-custom').hidden = st.preset !== 'custom';
      if (st.preset !== 'custom') { st.page = 0; load(); }
    });
    $('#anaFilters').addEventListener('submit', e => {
      e.preventDefault();
      st.role = $('#anaRole').value; st.status = $('#anaStatus').value; st.user = $('#anaUser').value.trim();
      if (st.preset === 'custom') {
        st.from = $('#anaFrom').value; st.to = $('#anaTo').value;
        if (!st.from || !st.to) return toast('Choose both a start and an end date.', 'err');
        if (st.to < st.from) return toast('The end date must be on or after the start date.', 'err');
      }
      st.page = 0; load();
    });
    $('#anaExcel').addEventListener('click', e => exportExcel(e.currentTarget));
    root.addEventListener('click', e => { const p = e.target.closest('[data-page]'); if (p) { st.page = Math.max(0, st.page + +p.dataset.page); loadRecords(); } });
    $('#campRoot').addEventListener('click', onCampaignClick);
    $('#campRoot').addEventListener('change', e => { if (e.target.id === 'ecAudience') { camp.audience = e.target.value; camp.subject = $('#ecSubject').value; camp.body = $('#ecBody').value; drawCampaigns(); } });
  }

  return { render, wire, metrics, insights, pct };
})();
