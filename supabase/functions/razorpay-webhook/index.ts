// Razorpay webhook receiver. Deploy with --no-verify-jwt (Razorpay can't send a Supabase token).
// Security: HMAC signature over the raw body; idempotent via payment_events(provider, event_id);
// subscription state is re-fetched from Razorpay's API so out-of-order events can't regress it.
import { adminClient, env, serve } from '../_shared/http.ts';
import { hmacSha256Hex, razorpay, toRow, verifyWebhookSignature, type RzpSubscription } from '../_shared/razorpay.ts';

const ok = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async req => {
  if (req.method !== 'POST') return ok({ error: 'Method not allowed' }, 405);
  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  if (!signature || !(await verifyWebhookSignature(raw, signature, env('RAZORPAY_WEBHOOK_SECRET')))) {
    return ok({ error: 'Invalid signature' }, 401);
  }

  const event = JSON.parse(raw);
  const eventId = req.headers.get('x-razorpay-event-id') ?? (await hmacSha256Hex('event-id', raw));
  const admin = adminClient();

  // Idempotency: record the event first; skip if it was already processed successfully.
  const { data: inserted } = await admin.from('payment_events')
    .upsert({ provider: 'razorpay', event_id: eventId, event_type: event.event, payload: event },
      { onConflict: 'provider,event_id', ignoreDuplicates: true })
    .select('id');
  if (!inserted?.length) {
    const { data: prev } = await admin.from('payment_events').select('processed_at')
      .eq('provider', 'razorpay').eq('event_id', eventId).single();
    if (prev?.processed_at) return ok({ ok: true, duplicate: true });
  }

  try {
    const subEntity = event.payload?.subscription?.entity as RzpSubscription | undefined;
    const payEntity = event.payload?.payment?.entity as { id: string; subscription_id?: string; error_description?: string } | undefined;
    const subId = subEntity?.id ?? payEntity?.subscription_id;

    if (String(event.event).startsWith('subscription.') && subId) {
      const fresh = await razorpay<RzpSubscription>(`/subscriptions/${encodeURIComponent(subId)}`);
      const update = toRow(fresh);
      const { data: existing } = await admin.from('subscriptions').select('id').eq('provider_subscription_id', subId).maybeSingle();
      if (existing) {
        await admin.from('subscriptions').update(update).eq('id', existing.id).throwOnError();
      } else if (fresh.notes?.user_id && fresh.notes?.plan_id) {
        // Subscription created outside our checkout flow but tagged with our notes
        await admin.from('subscriptions').insert({
          user_id: fresh.notes.user_id, plan_id: fresh.notes.plan_id, provider: 'razorpay', provider_subscription_id: subId, ...update,
        }).throwOnError();
      }
    } else if (event.event === 'payment.failed' && payEntity && subId) {
      await admin.rpc('notify_payment_failed', {
        p_provider_subscription_id: subId, p_payment_id: payEntity.id, p_reason: payEntity.error_description ?? '',
      }).throwOnError();
    }

    await admin.from('payment_events').update({ processed_at: new Date().toISOString(), error: null })
      .eq('provider', 'razorpay').eq('event_id', eventId);
    return ok();
  } catch (err) {
    console.error('webhook processing failed', err);
    await admin.from('payment_events').update({ error: String(err).slice(0, 500) })
      .eq('provider', 'razorpay').eq('event_id', eventId);
    return ok({ error: 'processing failed' }, 500);  // non-2xx makes Razorpay retry later
  }
});
