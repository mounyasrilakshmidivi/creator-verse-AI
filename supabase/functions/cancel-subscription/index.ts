// Cancels the user's subscription at the end of the paid cycle (they keep Premium until then).
import { adminClient, HttpError, json, readJson, requireUser, serve } from '../_shared/http.ts';
import { razorpay, toRow, type RzpSubscription } from '../_shared/razorpay.ts';

serve(async req => {
  const admin = adminClient();
  const user = await requireUser(req, admin);
  await readJson<Record<string, never>>(req);

  const { data: row } = await admin.from('subscriptions').select('id, provider_subscription_id, cancel_at_period_end')
    .eq('user_id', user.id).in('status', ['active', 'authenticated', 'pending']).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!row) throw new HttpError(404, 'No active subscription to cancel');
  if (row.cancel_at_period_end) return json(req, { ok: true, already: true });

  const sub = await razorpay<RzpSubscription>(`/subscriptions/${encodeURIComponent(row.provider_subscription_id)}/cancel`, {
    method: 'POST', body: { cancel_at_cycle_end: 1 },
  });
  const { error } = await admin.from('subscriptions').update({ ...toRow(sub), cancel_at_period_end: true }).eq('id', row.id);
  if (error) throw error;
  return json(req, { ok: true, status: sub.status });
});
