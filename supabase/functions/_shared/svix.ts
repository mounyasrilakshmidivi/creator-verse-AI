// Verifies Resend webhook signatures (Resend uses Svix): HMAC-SHA256 over `${id}.${timestamp}.${body}`
// with the base64 secret that follows "whsec_". The svix-signature header may hold several "v1,<sig>" entries.
import { safeEqual } from './razorpay.ts';

export async function verifySvix(secret: string, headers: Headers, body: string, toleranceSec = 300, now = Date.now()): Promise<boolean> {
  const id = headers.get('svix-id'), ts = headers.get('svix-timestamp'), sigHeader = headers.get('svix-signature');
  if (!id || !ts || !sigHeader) return false;
  if (Math.abs(now / 1000 - Number(ts)) > toleranceSec) return false;  // replay protection
  const keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const expected = btoa(String.fromCharCode(...mac));
  return sigHeader.split(' ').some(part => {
    const [version, sig] = part.split(',');
    return version === 'v1' && !!sig && safeEqual(sig, expected);
  });
}
