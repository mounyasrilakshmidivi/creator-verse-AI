// Resend delivery events -> email_outbox status (delivered / bounced / complained).
// Deploy with --no-verify-jwt; authenticity comes from the Svix signature (RESEND_WEBHOOK_SECRET).
import { adminClient, env, serve } from '../_shared/http.ts';
import { verifySvix } from '../_shared/svix.ts';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const TRACKED = new Set(['email.delivered', 'email.bounced', 'email.complained']);

serve(async req => {
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const raw = await req.text();
  if (!(await verifySvix(env('RESEND_WEBHOOK_SECRET'), req.headers, raw))) return reply({ error: 'Invalid signature' }, 401);
  const event = JSON.parse(raw) as { type?: string; data?: { email_id?: string } };
  if (!event.type || !TRACKED.has(event.type) || !event.data?.email_id) return reply({ ok: true, ignored: true });
  const { data, error } = await adminClient().rpc('record_email_event', { p_provider_message_id: event.data.email_id, p_event: event.type });
  if (error) { console.error('record_email_event failed', error); return reply({ error: 'processing failed' }, 500); }  // Resend retries
  return reply({ ok: true, matched: data });
});
