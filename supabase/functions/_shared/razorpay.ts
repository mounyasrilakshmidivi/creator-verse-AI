// Minimal Razorpay client: REST calls with Basic auth and HMAC signature checks.
// Docs: https://razorpay.com/docs/api/payments/subscriptions/ and /webhooks/
import { env, HttpError } from './http.ts';

const API = 'https://api.razorpay.com/v1';

export async function razorpay<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const auth = btoa(`${env('RAZORPAY_KEY_ID')}:${env('RAZORPAY_KEY_SECRET')}`);
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: { description?: string } }).error?.description ?? `Razorpay error ${res.status}`;
    console.error('razorpay', path, res.status, msg);
    throw new HttpError(502, `Payment provider error: ${msg}`);
  }
  return data as T;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time comparison so signatures can't be guessed byte by byte.
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Checkout handler signature for subscriptions: HMAC(payment_id + "|" + subscription_id, key_secret)
export async function verifyCheckoutSignature(paymentId: string, subscriptionId: string, signature: string, secret: string) {
  return safeEqual(await hmacSha256Hex(secret, `${paymentId}|${subscriptionId}`), signature);
}

// Webhook signature: HMAC(raw request body, webhook_secret)
export async function verifyWebhookSignature(rawBody: string, signature: string, secret: string) {
  return safeEqual(await hmacSha256Hex(secret, rawBody), signature);
}

export interface RzpSubscription {
  id: string; plan_id: string; status: string;
  current_start: number | null; current_end: number | null; notes?: Record<string, string>;
}

const STATUSES = ['created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired'];

// Maps a Razorpay subscription entity to our subscriptions columns.
export function toRow(s: RzpSubscription) {
  const ts = (n: number | null) => (n ? new Date(n * 1000).toISOString() : null);
  return {
    // Razorpay "paused" and unknown states are treated as not entitled.
    status: STATUSES.includes(s.status) ? s.status : 'halted',
    current_period_start: ts(s.current_start),
    current_period_end: ts(s.current_end),
    updated_at: new Date().toISOString(),
  };
}
