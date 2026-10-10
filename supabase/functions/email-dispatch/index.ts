// Sends queued emails from public.email_outbox through Resend.
// Triggered by a Supabase Database Webhook on email_outbox INSERT and by a pg_cron retry job.
// Deploy with --no-verify-jwt; callers must send the x-dispatch-secret header.
// Delivery failures are recorded on the outbox row and never touch application data.
import { adminClient, env, serve } from '../_shared/http.ts';
import { safeEqual } from '../_shared/razorpay.ts';
import { renderEmail, sendWithResend } from '../_shared/email.ts';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async req => {
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (!safeEqual(req.headers.get('x-dispatch-secret') ?? '', env('EMAIL_DISPATCH_SECRET'))) return reply({ error: 'Forbidden' }, 403);

  const apiKey = env('RESEND_API_KEY');
  const from = env('EMAIL_FROM');
  const baseUrl = env('APP_BASE_URL');
  const admin = adminClient();

  const { data: batch, error } = await admin.rpc('claim_email_batch', { p_limit: 20 });
  if (error) throw error;

  const results = { sent: 0, failed: 0 };
  // Resend allows ~2 requests/second on standard plans; space sends out (campaigns are queued in batches of 20).
  const spacingMs = Number(Deno.env.get('EMAIL_SEND_SPACING_MS') ?? 600);
  let first = true;
  for (const row of batch ?? []) {
    if (!first) await new Promise(r => setTimeout(r, spacingMs));
    first = false;
    try {
      const msg = renderEmail(row.template, row.data ?? {}, baseUrl);
      const id = await sendWithResend({ apiKey, from, to: row.to_email, ...msg, idempotencyKey: `outbox-${row.id}` });
      await admin.from('email_outbox').update({ status: 'sent', provider_message_id: id, sent_at: new Date().toISOString(), last_error: null }).eq('id', row.id);
      results.sent++;
    } catch (err) {
      console.error('email send failed', row.id, err);
      await admin.from('email_outbox').update({ status: 'failed', last_error: String(err).slice(0, 500) }).eq('id', row.id);
      results.failed++;
    }
  }
  return reply({ ok: true, claimed: batch?.length ?? 0, ...results });
});
