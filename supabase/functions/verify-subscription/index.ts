// Called after Razorpay Checkout returns. The browser's "success" is not trusted:
// 1) the checkout signature is verified with the key secret, and
// 2) the subscription status is fetched from Razorpay's API before anything is stored.
import { adminClient, env, HttpError, json, readJson, requireUser, serve } from '../_shared/http.ts';
import { razorpay, toRow, verifyCheckoutSignature, type RzpSubscription } from '../_shared/razorpay.ts';

interface Body { razorpay_payment_id?: string; razorpay_subscription_id?: string; razorpay_signature?: string }

serve(async req => {
  const admin = adminClient();
  const user = await requireUser(req, admin);
  const b = await readJson<Body>(req);
  if (!b.razorpay_payment_id || !b.razorpay_subscription_id || !b.razorpay_signature) throw new HttpError(400, 'Missing payment details');

  const { data: row } = await admin.from('subscriptions').select('id, user_id')
    .eq('provider_subscription_id', b.razorpay_subscription_id).maybeSingle();
  if (!row || row.user_id !== user.id) throw new HttpError(404, 'Subscription not found');

  const valid = await verifyCheckoutSignature(b.razorpay_payment_id, b.razorpay_subscription_id, b.razorpay_signature, env('RAZORPAY_KEY_SECRET'));
  if (!valid) throw new HttpError(400, 'Payment signature could not be verified');

  const sub = await razorpay<RzpSubscription>(`/subscriptions/${encodeURIComponent(b.razorpay_subscription_id)}`);
  const update = toRow(sub);
  const { error } = await admin.from('subscriptions').update(update).eq('id', row.id);
  if (error) throw error;

  return json(req, {
    status: update.status,
    premium: update.status === 'active',
    message: update.status === 'active'
      ? 'Payment confirmed by Razorpay. Premium is active.'
      : 'Payment authorised. Waiting for Razorpay to confirm the charge; this page will update automatically.',
  });
});
