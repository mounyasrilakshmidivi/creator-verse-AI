// Shared HTTP helpers for Edge Functions.
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.45.4';

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new ConfigError(`Missing server environment variable ${name}`);
  return v;
}
export class ConfigError extends Error {}
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function allowedOrigin(req: Request): string {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? Deno.env.get('APP_BASE_URL') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get('origin') ?? '';
  return allowed.includes(origin) ? origin : allowed[0] ?? '';
}

export function cors(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(req),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });
}

// Wraps a handler with CORS preflight and consistent error responses (no stack traces leak).
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async req => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof HttpError) return json(req, { error: err.message }, err.status);
      if (err instanceof ConfigError) {
        console.error(err.message);
        return json(req, { error: 'This feature is not configured on the server yet.', setup_required: true }, 503);
      }
      console.error(err);
      return json(req, { error: 'Unexpected server error' }, 500);
    }
  });
}

export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
}

// Validates the caller's Supabase access token and returns the user (must have a verified email).
export async function requireUser(req: Request, admin: SupabaseClient): Promise<User> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Sign in required');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Your session has expired. Please sign in again.');
  if (!data.user.email_confirmed_at) throw new HttpError(403, 'Verify your email address first.');
  return data.user;
}

export async function readJson<T>(req: Request): Promise<T> {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  try { return await req.json() as T; } catch { throw new HttpError(400, 'Invalid JSON body'); }
}
