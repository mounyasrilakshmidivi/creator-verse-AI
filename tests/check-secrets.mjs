// Fails if anything that looks like a server secret appears in files the browser can load,
// or if a real .env file is tracked/served. Run: npm run check:secrets
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = ['index.html', 'js', 'css', 'api/config.js'];
const PATTERNS = [
  [/service_role/i, 'Supabase service-role reference'],
  [/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'hard-coded JWT (Supabase key)'],
  [/rzp_(live|test)_[A-Za-z0-9]{10,}/, 'hard-coded Razorpay key ID'],
  [/RAZORPAY_(KEY_SECRET|WEBHOOK_SECRET)/, 'Razorpay secret variable name in client code'],
  [/\bre_[A-Za-z0-9]{16,}/, 'Resend API key'],
  [/RESEND_API_KEY|EMAIL_DISPATCH_SECRET|SUPABASE_SERVICE_ROLE_KEY/, 'server secret variable name in client code'],
  [/GOCSPX-[A-Za-z0-9_-]{10,}/, 'Google OAuth client secret'],
];
const files = [];
const walk = p => statSync(p).isDirectory() ? readdirSync(p).forEach(f => walk(join(p, f))) : files.push(p);
PUBLIC.filter(existsSync).forEach(walk);

let problems = 0;
for (const f of files.filter(f => /\.(js|html|css|json)$/.test(f) && !f.includes('vendor'))) {
  const text = readFileSync(f, 'utf8');
  for (const [re, label] of PATTERNS) if (re.test(text)) { console.error(`✖ ${f}: ${label}`); problems++; }
}
const ignore = readFileSync('.gitignore', 'utf8');
if (!/^\.env$/m.test(ignore)) { console.error('✖ .gitignore does not ignore .env'); problems++; }
if (!/^supabase\/\.env\.functions$/m.test(ignore)) { console.error('✖ .gitignore does not ignore supabase/.env.functions'); problems++; }
console.log(problems ? `${problems} problem(s) found` : `✔ no secrets in ${files.length} browser-served files; .env files are git-ignored`);
process.exit(problems ? 1 : 0);
