// Creates a Razorpay subscription for a Premium plan and returns what Razorpay Checkout needs.
// Premium is NOT granted here: access starts only when verify-subscription or the webhook
// confirms an "active" subscription from Razorpay's API.
import { adminClient, env, HttpError, json, readJson, requireUser, serve } from '../_shared/http.ts';
import { razorpay, type RzpSubscription } from '../_shared/razorpay.ts';

serve(async req => {
  const admin = adminClient();
  const user = await requireUser(req, admin);
  const { plan_id } = await readJson<{ plan_id?: string }>(req);

  const { data: plan } = await admin.from('plans').select('*').eq('id', plan_id ?? '').eq('is_active', true).maybeSingle();
  if (!plan || plan.tier !== 'premium') throw new HttpError(400, 'Unknown plan');
  if (!plan.razorpay_plan_id) throw new HttpError(503, 'This plan is not connected to a Razorpay plan yet (admin setup required).');

  const { data: settings } = await admin.from('app_settings').select('value').eq('key', 'payments_enabled').maybeSingle();
  if (settings && settings.value === false) throw new HttpError(503, 'Payments are currently disabled.');

  const { data: current } = await admin.from('subscriptions').select('status, current_period_end')
    .eq('user_id', user.id).in('status', ['active', 'pending', 'authenticated']).limit(1).maybeSingle();
  if (current && (!current.current_period_end || new Date(current.current_period_end) > new Date())) {
    throw new HttpError(409, 'You already have a Premium subscription. Manage it from Billing.');
  }

  const sub = await razorpay<RzpSubscription>('/subscriptions', {
    method: 'POST',
    body: {
      plan_id: plan.razorpay_plan_id,
      total_count: plan.billing_interval === 'year' ? 10 : 120,  // renews until cancelled (max cycles)
      quantity: 1,
      customer_notify: 1,
      notes: { user_id: user.id, plan_id: plan.id },
    },
  });

  const { error } = await admin.from('subscriptions').insert({
    user_id: user.id, provider: 'razorpay', provider_subscription_id: sub.id, plan_id: plan.id, status: 'created',
  });
  if (error) throw error;

  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', user.id).single();
  return json(req, {
    subscription_id: sub.id,
    key_id: env('RAZORPAY_KEY_ID'),
    plan: { id: plan.id, name: plan.name, price_inr: plan.price_inr, interval: plan.billing_interval },
    prefill: { email: user.email, name: profile?.full_name ?? '' },
    test_mode: env('RAZORPAY_KEY_ID').startsWith('rzp_test_'),
  });
});
