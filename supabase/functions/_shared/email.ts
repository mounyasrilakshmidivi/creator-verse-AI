// Branded transactional email templates (CreatorVerse AI) and the Resend sender.
// Emails never include passwords, payment-card data or other sensitive personal details.

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmtDate = (s: unknown) => (s ? new Date(String(s)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const inr = (n: unknown) => '₹' + Number(n ?? 0).toLocaleString('en-IN');

interface Rendered { subject: string; heading: string; paragraphs: string[]; cta?: string; ctaLink?: string }
type Data = Record<string, unknown>;

const TEMPLATES: Record<string, (d: Data) => Rendered> = {
  welcome: d => ({
    subject: 'Welcome to CreatorVerse AI',
    heading: `Welcome${d.name ? ', ' + esc(d.name) : ''} 🎉`,
    paragraphs: [
      `Your <b>${d.role === 'creator' ? 'Creator' : d.role === 'brand' ? 'Brand' : 'CreatorVerse AI'}</b> account is verified and ready.`,
      '<b>1. Complete your profile:</b> open Account settings, add your details and publish your profile so others can find you.',
      d.role === 'brand'
        ? '<b>2. Discover creators:</b> search the marketplace or use AI Matching to find creators for your campaign.'
        : '<b>2. Discover brands:</b> browse member brands and open campaigns that match your niche.',
      '<b>3. Send collaboration requests:</b> use Request Collaboration on any member profile to propose a project.',
      '<b>4. Connect:</b> press Connect to build your network and message people directly.',
    ],
    cta: 'Complete your profile', ctaLink: '#/account',
  }),
  login_alert: d => ({
    subject: 'New sign-in to your CreatorVerse AI account',
    heading: 'New sign-in',
    paragraphs: [
      `Your account was signed in to on <b>${esc(d.at ? new Date(String(d.at)).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST' : 'just now')}</b>${d.method && d.method !== 'email' ? ` using ${esc(d.method)}` : ''}.`,
      'If this was you, no action is needed.',
      'If you don\'t recognise this sign-in, reset your password right away. CreatorVerse AI will never ask for your password by email.',
    ],
    cta: 'Review account', ctaLink: '#/account',
  }),
  new_message: d => ({
    subject: `New message from ${d.name || 'a CreatorVerse AI member'}`,
    heading: 'You have a new message',
    paragraphs: [`<b>${esc(d.name || 'A member')}</b> sent you a message on CreatorVerse AI. Sign in to read and reply.`,
      'For your privacy, message contents are not included in emails. You get at most one email per conversation per hour.'],
    cta: 'Open conversation', ctaLink: String(d.link || '#/messages'),
  }),
  campaign: d => ({
    subject: String(d.subject || 'News from CreatorVerse AI'),
    heading: esc(String(d.subject || 'News from CreatorVerse AI').replace(/^\[TEST\]\s*/, '')),
    paragraphs: String(d.body || '').split(/\n{2,}/).map(p => esc(p.trim()).replace(/\n/g, '<br>')).filter(Boolean),
    cta: 'Visit CreatorVerse AI', ctaLink: '#/',
  }),
  security_password_changed: () => ({
    subject: 'Your CreatorVerse AI password was changed',
    heading: 'Password changed',
    paragraphs: ['The password for your CreatorVerse AI account was just changed.',
      'If this was you, no action is needed. If not, reset your password immediately and contact support.'],
    cta: 'Reset password', ctaLink: '#/forgot',
  }),
  security_email_changed: () => ({
    subject: 'Your CreatorVerse AI sign-in email was changed',
    heading: 'Sign-in email changed',
    paragraphs: ['The email address used to sign in to CreatorVerse AI was changed to this address.',
      'If you did not make this change, reset your password and contact support right away.'],
    cta: 'Review account', ctaLink: '#/account',
  }),
  creator_profile_published: d => ({
    subject: 'Your creator profile is live',
    heading: `Nice work, ${esc(d.name)}!`,
    paragraphs: ['Your creator profile is published. Brands can now find you and invite you to campaigns.'],
    cta: 'View your profile settings', ctaLink: '#/account',
  }),
  campaign_created: d => ({
    subject: `Campaign launched: ${d.campaign}`,
    heading: 'Your campaign is live 🚀',
    paragraphs: [`<b>${esc(d.campaign)}</b> is now visible to creators. Applications are open until ${esc(fmtDate(d.deadline))}.`,
      'We will email you when creators apply.'],
    cta: 'Manage campaigns', ctaLink: '#/campaigns',
  }),
  application_received: d => ({
    subject: `New application: ${d.campaign}`,
    heading: 'A creator applied to your campaign',
    paragraphs: [`<b>${esc(d.creator)}</b> applied to <b>${esc(d.campaign)}</b>. Review their pitch and rate in CreatorVerse AI.`],
    cta: 'Review applications', ctaLink: '#/campaigns',
  }),
  application_update: d => ({
    subject: `Your application was ${d.status}`,
    heading: `Application ${esc(d.status)}`,
    paragraphs: [`${esc(d.brand)} marked your application for <b>${esc(d.campaign)}</b> as <b>${esc(d.status)}</b>.`],
    cta: 'View applications', ctaLink: '#/campaigns',
  }),
  collab_request_sent: d => ({
    subject: `Request saved: ${d.creator}`,
    heading: 'Collaboration request saved',
    paragraphs: [`Your request to <b>${esc(d.creator)}</b> (budget ${esc(inr(d.budget))}, go-live ${esc(fmtDate(d.go_live))}) is saved.`,
      'Note: creators in the sample directory are fictional, so they will not receive this request.'],
    cta: 'View requests', ctaLink: '#/campaigns',
  }),
  usage_warning: d => ({
    subject: 'You are close to your plan limit',
    heading: 'Heads up: usage at ' + esc(d.used) + ' of ' + esc(d.limit),
    paragraphs: [`You have used ${esc(d.used)} of ${esc(d.limit)} ${esc(d.feature)} this ${esc(d.period)}.`,
      'Premium raises your limits so your campaigns are never interrupted.'],
    cta: 'See plans', ctaLink: '#/pricing',
  }),
  usage_limit_reached: d => ({
    subject: `You've reached your ${d.feature} limit`,
    heading: 'Plan limit reached',
    paragraphs: [`You have used all ${esc(d.limit)} ${esc(d.feature)} included this ${esc(d.period)}.`,
      'Your account and saved data are still available. Upgrade to Premium to continue now, or wait for your limits to reset.'],
    cta: 'Upgrade to Premium', ctaLink: '#/pricing',
  }),
  subscription_activated: d => ({
    subject: 'Premium is active: payment confirmed',
    heading: 'Welcome to Premium ✨',
    paragraphs: [`Razorpay confirmed your payment for <b>${esc(d.plan)}</b>.`,
      d.period_end ? `Your current period runs until ${esc(fmtDate(d.period_end))}.` : ''],
    cta: 'View billing', ctaLink: '#/billing',
  }),
  subscription_renewed: d => ({
    subject: 'Premium renewed',
    heading: 'Your Premium subscription renewed',
    paragraphs: [`${esc(d.plan)} renewed successfully until ${esc(fmtDate(d.period_end))}.`],
    cta: 'View billing', ctaLink: '#/billing',
  }),
  subscription_cancel_scheduled: d => ({
    subject: 'Premium will not renew',
    heading: 'Cancellation confirmed',
    paragraphs: [`Your ${esc(d.plan)} subscription will not renew. You keep Premium until ${esc(fmtDate(d.period_end) || 'the end of the current period')}.`],
    cta: 'View billing', ctaLink: '#/billing',
  }),
  subscription_ended: d => ({
    subject: d.status === 'halted' ? 'Action needed: Premium payment failed' : 'Your Premium plan has ended',
    heading: d.status === 'halted' ? 'We could not renew Premium' : 'You are back on the Free plan',
    paragraphs: [d.status === 'halted'
      ? 'Razorpay could not charge your payment method, so Premium is paused. Your data is safe.'
      : 'Your Premium subscription has ended. Your account and data remain available on the Free plan.'],
    cta: 'Manage billing', ctaLink: '#/billing',
  }),
  admin_new_registration: d => ({
    subject: `New registration: ${d.name || d.email}`,
    heading: 'A new user registered',
    paragraphs: [`<b>${esc(d.name || 'New user')}</b> (${esc(d.email)}) verified their email.`,
      `Account type: ${esc(d.role || 'not chosen yet')} · Status: <b>${esc(d.status)}</b>`,
      d.status === 'pending' ? 'This account is waiting for your approval.' : ''],
    cta: 'Open admin dashboard', ctaLink: '#/admin',
  }),
  account_pending: () => ({
    subject: 'Your CreatorVerse AI account is awaiting approval',
    heading: 'Thanks for registering',
    paragraphs: ['Your email is verified. An administrator will review your account shortly, and we will email you as soon as it is approved.'],
    cta: 'Check status', ctaLink: '#/dashboard',
  }),
  account_approved: d => ({
    subject: d.reactivated ? 'Your CreatorVerse AI account has been reactivated' : 'Your CreatorVerse AI account is approved',
    heading: d.reactivated ? 'Welcome back' : 'You are approved 🎉',
    paragraphs: ['You now have full access to CreatorVerse AI: explore creators, run AI matching and launch campaigns.'],
    cta: 'Open your dashboard', ctaLink: '#/dashboard',
  }),
  account_rejected: d => ({
    subject: 'Your CreatorVerse AI registration was not approved',
    heading: 'Registration not approved',
    paragraphs: ['After review, your CreatorVerse AI registration was not approved.',
      d.reason ? `Reason: ${esc(d.reason)}` : '', 'If you think this is a mistake, reply to this email or contact support.'],
  }),
  account_suspended: d => ({
    subject: 'Your CreatorVerse AI account has been suspended',
    heading: 'Account suspended',
    paragraphs: ['Your CreatorVerse AI account has been suspended. You can still sign in, but marketplace actions are disabled.',
      d.reason ? `Reason: ${esc(d.reason)}` : '', 'Contact support if you have questions.'],
  }),
  connection_request: d => ({
    subject: `${d.name || 'A member'} wants to connect on CreatorVerse AI`,
    heading: 'New connection request',
    paragraphs: [`<b>${esc(d.name || 'A member')}</b> sent you a connection request. Accept it to message each other and stay in touch.`],
    cta: 'Review request', ctaLink: '#/connections',
  }),
  connection_accepted: d => ({
    subject: `${d.name || 'A member'} accepted your connection request`,
    heading: 'You are connected',
    paragraphs: [`<b>${esc(d.name || 'A member')}</b> accepted your connection request. You can now message each other.`],
    cta: 'Open messages', ctaLink: '#/messages',
  }),
  member_collab_request: d => ({
    subject: `Collaboration request: ${d.subject || 'new request'}`,
    heading: 'You have a new collaboration request',
    paragraphs: [`<b>${esc(d.name || 'A member')}</b> sent you a collaboration request: <b>${esc(d.subject || 'Collaboration')}</b>${d.purpose ? ` (${esc(d.purpose)})` : ''}.`,
      d.budget ? `Proposed budget: ${esc(inr(d.budget))}` : '', 'Accept, decline or reply from your dashboard.'],
    cta: 'View request', ctaLink: '#/requests',
  }),
  member_collab_update: d => ({
    subject: `Collaboration ${d.status || 'update'}: ${d.subject || 'your request'}`,
    heading: `Collaboration ${esc(d.status || 'update')}`,
    paragraphs: [`<b>${esc(d.name || 'A member')}</b> ${esc(d.status === 'completed' ? 'marked as completed' : (d.status || 'updated'))} the collaboration request <b>${esc(d.subject || '')}</b>.`],
    cta: d.status === 'accepted' ? 'Start the conversation' : 'View requests', ctaLink: d.status === 'accepted' ? '#/messages' : '#/requests',
  }),
  payment_failed: () => ({
    subject: 'Payment failed',
    heading: 'Your payment did not go through',
    paragraphs: ['Razorpay reported a failed payment for your CreatorVerse AI Premium subscription. No Premium time was added.',
      'You can try again from the Billing page.'],
    cta: 'Go to billing', ctaLink: '#/billing',
  }),
};

export function renderEmail(template: string, data: Data, baseUrl: string) {
  const t = TEMPLATES[template];
  if (!t) throw new Error(`Unknown email template ${template}`);
  const r = t(data);
  const href = r.ctaLink ? `${baseUrl.replace(/\/$/, '')}/${r.ctaLink}` : baseUrl;
  const unsubscribeUrl = data.unsubscribe_token ? `${baseUrl.replace(/\/$/, '')}/?unsubscribe=${encodeURIComponent(String(data.unsubscribe_token))}` : '';
  const body = r.paragraphs.filter(Boolean).map(p => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#2a3145">${p}</p>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f1fb;font-family:Inter,Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #ebe8f2">
<tr><td style="background:linear-gradient(90deg,#7137f0,#d82de5);background-color:#8138e8;padding:22px 28px;color:#fff">
<div style="font-size:20px;font-weight:800;letter-spacing:-.02em">CreatorVerse AI</div>
<div style="font-size:12px;opacity:.85">Creators × Brands × AI</div></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:22px;color:#11172a">${r.heading}</h1>${body}
${r.cta ? `<a href="${esc(href)}" style="display:inline-block;margin-top:6px;padding:12px 22px;border-radius:999px;background:#8138e8;color:#fff;font-weight:600;text-decoration:none">${esc(r.cta)}</a>` : ''}
</td></tr>
<tr><td style="padding:18px 28px;background:#08152e;color:#9fb0cf;font-size:12px;line-height:1.5">
${unsubscribeUrl ? `You are receiving this because you opted in to CreatorVerse AI updates.
<a href="${esc(unsubscribeUrl)}" style="color:#c9a6ff">Unsubscribe</a> with one click, or manage preferences in <a href="${esc(baseUrl)}/#/account" style="color:#c9a6ff">Account settings</a>.`
  : `${data.test ? '<b>Test email</b>: only the administrator received this. ' : ''}You received this because of activity on your CreatorVerse AI account.
Manage email preferences in <a href="${esc(baseUrl)}/#/account" style="color:#c9a6ff">Account settings</a>.`}
</td></tr></table></td></tr></table></body></html>`;
  const text = `${r.heading.replace(/<[^>]+>/g, '')}\n\n${r.paragraphs.filter(Boolean).map(p => p.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '')).join('\n\n')}\n\n${r.cta ? `${r.cta}: ${href}` : ''}${unsubscribeUrl ? `\n\nUnsubscribe: ${unsubscribeUrl}` : ''}`;
  return { subject: r.subject, html, text, unsubscribeUrl };
}

export async function sendWithResend(opts: { apiKey: string; from: string; to: string; subject: string; html: string; text: string; idempotencyKey: string; unsubscribeUrl?: string }) {
  // marketing emails carry RFC 8058 one-click unsubscribe headers
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': opts.idempotencyKey },
    body: JSON.stringify({ from: opts.from, to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text,
      ...(opts.unsubscribeUrl && { headers: { 'List-Unsubscribe': `<${opts.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(data as { message?: string }).message ?? 'send failed'}`);
  return (data as { id: string }).id;
}

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);
