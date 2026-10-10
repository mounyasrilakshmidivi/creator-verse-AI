-- Email outbox helpers used only by the email-dispatch Edge Function (service role).

-- Atomically claims up to p_limit emails so concurrent dispatchers never send the same row twice.
create or replace function public.claim_email_batch(p_limit integer default 20)
returns setof public.email_outbox
language sql security definer set search_path = '' as $$
  update public.email_outbox o
  set status = 'sending', attempts = o.attempts + 1
  where o.id in (
    select id from public.email_outbox
    where (status = 'pending' or (status = 'failed' and attempts < 5)
           or (status = 'sending' and created_at < now() - interval '15 minutes'))  -- recover crashed sends
    order by created_at
    limit greatest(1, least(p_limit, 100))
    for update skip locked)
  returning o.*
$$;
revoke execute on function public.claim_email_batch from public, anon, authenticated;
grant execute on function public.claim_email_batch to service_role;

-- Used by the webhook for events that are not subscription-row changes (e.g. a failed renewal charge).
create or replace function public.notify_payment_failed(p_provider_subscription_id text, p_payment_id text, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_sub public.subscriptions;
begin
  select * into v_sub from public.subscriptions where provider_subscription_id = p_provider_subscription_id;
  if v_sub.id is null then return; end if;
  perform public.enqueue_event(v_sub.user_id, 'payment_failed', 'Payment failed',
    'We could not process your Premium payment. No Premium time was added.', '#/billing',
    'payment_failed', jsonb_build_object('reason', left(coalesce(p_reason, ''), 200)),
    'payment-failed:' || p_payment_id, 'billing_critical');
end $$;
revoke execute on function public.notify_payment_failed from public, anon, authenticated;
grant execute on function public.notify_payment_failed to service_role;
