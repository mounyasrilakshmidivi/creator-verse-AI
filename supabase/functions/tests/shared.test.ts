// deno test supabase/functions/tests
import { assert, assertEquals, assertFalse, assertThrows } from 'jsr:@std/assert@1.0.13';
import { hmacSha256Hex, safeEqual, toRow, verifyCheckoutSignature, verifyWebhookSignature } from '../_shared/razorpay.ts';
import { renderEmail, TEMPLATE_NAMES } from '../_shared/email.ts';

Deno.test('HMAC-SHA256 matches RFC 4231 test case 2', async () => {
  assertEquals(await hmacSha256Hex('Jefe', 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
});

Deno.test('webhook signature: accepts exact body, rejects tampering and wrong secret', async () => {
  const body = JSON.stringify({ event: 'subscription.charged', payload: {} });
  const sig = await hmacSha256Hex('whsec_test', body);
  assert(await verifyWebhookSignature(body, sig, 'whsec_test'));
  assertFalse(await verifyWebhookSignature(body + ' ', sig, 'whsec_test'));
  assertFalse(await verifyWebhookSignature(body, sig, 'other_secret'));
  assertFalse(await verifyWebhookSignature(body, '', 'whsec_test'));
});

Deno.test('checkout signature uses payment_id|subscription_id', async () => {
  const sig = await hmacSha256Hex('key_secret', 'pay_123|sub_456');
  assert(await verifyCheckoutSignature('pay_123', 'sub_456', sig, 'key_secret'));
  assertFalse(await verifyCheckoutSignature('pay_123', 'sub_999', sig, 'key_secret'));
});

Deno.test('safeEqual', () => {
  assert(safeEqual('abc', 'abc'));
  assertFalse(safeEqual('abc', 'abd'));
  assertFalse(safeEqual('abc', 'abcd'));
});

Deno.test('toRow maps Razorpay subscription fields; unknown states are not entitled', () => {
  const r = toRow({ id: 'sub_1', plan_id: 'plan_1', status: 'active', current_start: 1760000000, current_end: 1762592000 });
  assertEquals(r.status, 'active');
  assertEquals(r.current_period_end, new Date(1762592000 * 1000).toISOString());
  assertEquals(toRow({ id: 's', plan_id: 'p', status: 'paused', current_start: null, current_end: null }).status, 'halted');
});

Deno.test('every email template renders without placeholders and escapes HTML', () => {
  const data = { name: '<b>x</b>', campaign: 'Launch <script>', creator: 'Kavya', brand: 'Nova', status: 'shortlisted',
    feature: 'searches', used: 4, limit: 5, period: 'month', plan: 'Premium Monthly', period_end: '2026-11-10T00:00:00Z',
    deadline: '2026-11-01', budget: 15000, go_live: '2026-11-05', subject: 'Launch <stream>', purpose: 'Sponsored stream', email: 'a@b.test', role: 'brand', reason: 'Incomplete' };
  for (const t of TEMPLATE_NAMES) {
    const m = renderEmail(t, data, 'https://app.example.com');
    assert(m.subject.length > 3, t);
    assertFalse(/undefined|NaN|\[object/.test(m.html + m.text + m.subject), t);
    assertFalse(m.html.includes('<script>'), t);
    assert(m.html.includes('https://app.example.com'), t);
  }
  assertThrows(() => renderEmail('nope', {}, 'https://x'));
});

import { verifySvix } from '../_shared/svix.ts';

Deno.test('Resend (Svix) webhook signatures: valid, tampered, wrong secret, replayed', async () => {
  const secret = 'whsec_' + btoa('test-secret-key-1234567890');
  const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 're_1' } });
  const ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-secret-key-1234567890'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`msg_1.${ts}.${body}`)))));
  const h = (s: string, t = ts) => new Headers({ 'svix-id': 'msg_1', 'svix-timestamp': t, 'svix-signature': `v1,bogus v1,${s}` });
  assert(await verifySvix(secret, h(sig), body));
  assertFalse(await verifySvix(secret, h(sig), body + ' '));
  assertFalse(await verifySvix('whsec_' + btoa('other'), h(sig), body));
  assertFalse(await verifySvix(secret, h(sig, String(Number(ts) - 3600)), body));
  assertFalse(await verifySvix(secret, new Headers(), body));
});

Deno.test('campaign emails carry an unsubscribe link; message emails never include message text', () => {
  const c = renderEmail('campaign', { subject: 'October update', body: 'Line one\n\nLine <two>', unsubscribe_token: 'tok-123' }, 'https://app.example.com');
  assertEquals(c.unsubscribeUrl, 'https://app.example.com/?unsubscribe=tok-123');
  assert(c.html.includes('Unsubscribe') && c.text.includes('Unsubscribe: https://app.example.com/?unsubscribe=tok-123'));
  assert(c.html.includes('Line &lt;two&gt;'));
  const t = renderEmail('campaign', { subject: '[TEST] Hi', body: 'Body text here', test: true }, 'https://app.example.com');
  assertEquals(t.unsubscribeUrl, '');
  assert(t.html.includes('Test email'));
  const m = renderEmail('new_message', { name: 'Nova', link: '#/messages/m-1', body: 'secret budget 50000' }, 'https://app.example.com');
  assertFalse(m.html.includes('50000') || m.text.includes('50000'));
  assert(m.html.includes('#/messages/m-1'));
  const w = renderEmail('welcome', { name: 'Kavya', role: 'creator' }, 'https://app.example.com');
  assert(w.html.includes('Kavya') && w.html.includes('Creator'));
});
