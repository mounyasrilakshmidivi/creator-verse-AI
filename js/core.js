/* Shared helpers */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const icons = () => window.lucide?.createIcons();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const compact = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
const timeAgo = t => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
};

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('cverse:' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cverse:' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem('cverse:' + k); } catch { /* blocked */ } },
};

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'err' ? ' err' : '');
  t.innerHTML = `<i data-lucide="${type === 'err' ? 'alert-circle' : 'check-circle-2'}"></i>${esc(msg)}`;
  $('#toasts').append(t);
  icons();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
}

async function copyText(text, msg = 'Copied to clipboard') {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast(msg);
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>${label}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
    icons();
  }
}

// Stream AI text into a textarea, with a visible "thinking" state while the model reasons
async function aiIntoTextarea(ta, messages) {
  const placeholder = ta.placeholder;
  ta.value = '';
  ta.placeholder = '✨ AI is thinking…';
  ta.classList.add('ai-wait');
  try {
    const text = await AI.chat(messages, { onToken: (_, full) => { ta.classList.remove('ai-wait'); ta.value = full.replace(/\*\*/g, ''); ta.scrollTop = ta.scrollHeight; } });
    ta.value = text.replace(/\*\*/g, '').replace(/^["“]|["”]$/g, '').trim();
    return ta.value;
  } finally {
    ta.placeholder = placeholder;
    ta.classList.remove('ai-wait');
  }
}

/* Form validation: inline messages next to fields */
function setFieldError(el, msg) {
  const wrap = el.closest('.field') || el.parentElement;
  let err = wrap.querySelector('.field-err');
  if (!err) { err = document.createElement('small'); err.className = 'field-err'; err.setAttribute('role', 'alert'); wrap.append(err); }
  err.textContent = msg || '';
  err.hidden = !msg;
  el.classList.toggle('invalid', !!msg);
  el.setAttribute('aria-invalid', msg ? 'true' : 'false');
}
// rules: [[element, () => errorMessage | '']]; returns true when valid and focuses the first invalid field
function validateAll(rules) {
  let first = null;
  for (const [el, check] of rules) {
    const msg = check();
    setFieldError(el, msg);
    if (msg && !first) first = el;
  }
  first?.focus();
  return !first;
}
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const chipValues = sel => $$(`${sel} .on`).map(b => b.dataset.id);
const chipPicker = (id, items, on = []) => `<div class="chips-select" id="${id}" role="group">${items.map(([v, label, icon]) =>
  `<button type="button" data-id="${esc(v)}" class="${on.includes(v) ? 'on' : ''}" aria-pressed="${on.includes(v)}">${icon ? `<i data-lucide="${icon}"></i>` : ''}${esc(label)}</button>`).join('')}</div>`;
// Toggle chips inside a container (call once per render)
function bindChips(root, max = Infinity) {
  root.addEventListener('click', e => {
    const chip = e.target.closest('.chips-select button');
    if (!chip) return;
    const group = chip.parentElement;
    if (!chip.classList.contains('on') && $$('.on', group).length >= (+group.dataset.max || max)) return toast(`Pick up to ${+group.dataset.max || max}`, 'err');
    chip.classList.toggle('on');
    chip.setAttribute('aria-pressed', chip.classList.contains('on'));
  });
}
const loadScript = src => new Promise((resolve, reject) => {
  if ([...document.scripts].some(s => s.src === src)) return resolve();
  const s = Object.assign(document.createElement('script'), { src, async: true, onload: resolve, onerror: () => reject(new Error('Could not load ' + src)) });
  document.head.append(s);
});

const mdToHtml =text => (window.marked && window.DOMPurify) ? DOMPurify.sanitize(marked.parse(text)) : esc(text).replace(/\n/g, '<br>');

/* Lightbox */
function openLightbox(url, caption) {
  const lb = $('#lightbox');
  $('#lbImg').src = url;
  $('#lbCap').textContent = caption || '';
  lb.showModal();
}

/* Generic modal: returns the body element to fill */
function openModal(html, { wide = false } = {}) {
  const dlg = $('#modal');
  dlg.classList.toggle('wide', wide);
  $('#modalBody').innerHTML = html;
  if (!dlg.open) dlg.showModal();
  icons();
  return $('#modalBody');
}
const closeModal = () => $('#modal').close();

function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#8138E8', '#D82DE5', '#FF9948', '#20CFA7', '#4F8CFF'];
  box.innerHTML = Array.from({ length: 60 }, (_, i) =>
    `<i style="left:${Math.random() * 100}%;background:${colors[i % 5]};animation-delay:${Math.random() * .4}s;animation-duration:${1.6 + Math.random()}s;transform:rotate(${Math.random() * 360}deg)"></i>`).join('');
  // inside an open dialog so it renders above the modal's top layer
  (document.querySelector('dialog[open]') || document.body).append(box);
  setTimeout(() => box.remove(), 3200);
}
