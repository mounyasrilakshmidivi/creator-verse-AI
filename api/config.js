// Vercel serverless function: public, browser-safe configuration only.
// Never add secrets here (service-role key, Razorpay key secret, Resend key).
// Mirrors serve.ps1: base URL only, and a configProblem code instead of placeholder values.
export default function handler(req, res) {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/(rest|auth|storage|functions)\/v1\/?.*$/, '').replace(/\/+$/, '');
  const anon = (process.env.SUPABASE_ANON_KEY || '').trim();
  let problem = '';
  if (!url || !anon) problem = 'empty';
  else if (/your-project-ref/i.test(url) || /^your-/i.test(anon)) problem = 'placeholder';
  else if (!/^https?:\/\/[^\s/]+/.test(url)) problem = 'invalid_url';
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    supabaseUrl: problem ? '' : url,
    supabaseAnonKey: problem ? '' : anon,
    appBaseUrl: process.env.APP_BASE_URL || '',
    configProblem: problem,
  });
}
