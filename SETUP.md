# CreatorVerse AI: backend setup

Without these steps the site still runs (browsing, AI matching, AI Studio). Sign-in, saving,
quotas, emails and payments show **"Setup required"** until you connect the services below.

| Service | Used for | Where secrets live |
|---|---|---|
| **Supabase** | Auth (email + Google), Postgres with Row Level Security, Edge Functions | URL + anon key in `.env` (public). Everything else stays in Supabase |
| **Resend** | Transactional emails (welcome, security, campaigns, usage, billing) and SMTP for auth emails | Edge Function secret + Supabase SMTP settings |
| **Razorpay** | Premium subscriptions (monthly / yearly), signed webhooks | Edge Function secrets |
| **Google Cloud** | "Continue with Google" (OAuth) | Client secret stored in Supabase only |

### Why Razorpay, not Stripe?
Stripe has been invite-only for new Indian businesses since 2024, and your pricing is in INR. Razorpay supports
INR subscriptions (UPI Autopay, cards, e-mandates), has a full **test mode with no KYC**, and signed webhooks.
**Going live requires Razorpay KYC**: a business or individual PAN, a bank account in the business's name, and a live
website that shows your Terms, Privacy Policy, **Refund & Cancellation policy**, and contact details. You must also
request **Subscriptions** to be enabled on the account. Confirm the current requirements on Razorpay's site before applying.
If your business is registered outside India, tell me and I'll swap in a Stripe adapter (only `supabase/functions/_shared/razorpay.ts`
and three small functions change).

---

## 1. Supabase project
1. Create a project at https://supabase.com (choose the Mumbai region for Indian users).
2. **Apply the database migrations**, either way:
   - CLI (recommended):
     ```bash
     npx -y supabase login
     npx -y supabase link --project-ref YOUR_PROJECT_REF
     npx -y supabase db push
     ```
   - or paste each file from `supabase/migrations/` into **SQL Editor** and run it, in this order:
     1. `20261010000000_creatorverse_core.sql` (tables, security policies, plans, quotas, notifications)
     2. `20261010000100_email_dispatch.sql` (email queue helpers)
     3. `20261010000200_account_approval.sql` (account status, admin approvals, registration notifications)
     4. `20261010000300_network_and_analytics.sql` (login records, member profiles, connections, messaging, collaboration requests)
     5. `20261010000400_emails_campaigns_reports.sql` (welcome / sign-in / message emails, email preferences and consent,
        unsubscribe, email campaigns, delivery tracking, the login report behind the Excel download)

     They only create or extend objects; none drop tables or delete data. (5 replaces a few functions from 1 and 4 with
     newer versions using `create or replace`.)
3. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
4. Copy `.env.example` to `.env` and fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_BASE_URL` (e.g. `http://localhost:5173`).
   These three are the only values the browser ever sees. **Never put the service-role key in `.env`.**
   - The file must be named exactly `.env` in the project folder (next to `serve.ps1`). Notepad often saves it as
     `.env.txt` with the extension hidden; the setup screen and the server window will tell you if that happened.
   - `serve.ps1` re-reads `.env` on every page load, so just reload the browser after editing. Its console prints
     `Accounts: Supabase configured` or the exact reason it isn't.
   - Open the site through `serve.ps1` (`npm start` / `start.bat`), not by double-clicking `index.html`.
5. Make yourself an admin (SQL Editor, after you've signed up once):
   ```sql
   insert into public.app_admins (user_id) select id from auth.users where email = 'you@example.com';
   ```
   Admin rights come only from this table (written in SQL with owner privileges). The browser can't grant them.
6. Optional **account approval**: in the app, open **Admin → Feature & billing settings** and switch on
   `require_account_approval`. New sign-ups then start as *pending*. You get a notification (and an email once Resend is
   set up) for each verified registration, and you approve or reject them under **Admin → Users**. Users are emailed the result.

## 2. Auth settings (Supabase dashboard)
- **Authentication → URL Configuration**
  - Site URL: your production URL (or `http://localhost:5173` while developing)
  - Redirect URLs: add `http://localhost:5173/**` and `https://your-domain/**`
- **Authentication → Providers → Email**: *Confirm email* **ON**, *Secure email change* **ON**, minimum password length 8.
- **Local development: keep Supabase's default email templates.** With them, Supabase marks the email verified
  *before* redirecting to `http://localhost:5173`, so verification succeeds even if the site isn't running or you open
  the email on another device (on a phone, `localhost` means the phone, so the page can't load, but the account is still
  verified and you can sign in on the PC). The redirect target comes from `APP_BASE_URL`, and must be in **Redirect URLs**.
- **Production (public URL): optionally use the branded templates.** Under **Authentication → Email Templates**, paste the HTML from `supabase/templates/`
  (these verify inside the app, so the site must be reachable when the link is clicked):
  - *Confirm signup* → `confirmation.html` (subject: *Verify your CreatorVerse AI email*)
  - *Reset password* → `recovery.html`
  - *Change email address* → `email_change.html`

  These templates link to `/?token_hash=…&type=…`, which the app verifies with `verifyOtp`, so links work even when
  opened on another device. The signup email also contains a 6-digit code for the Verify page.
- **Authentication → SMTP Settings** (strongly recommended): Supabase's built-in mailer is for testing only. It is heavily
  rate-limited and may only deliver to your team's addresses. Use Resend's SMTP:
  host `smtp.resend.com`, port `465`, username `resend`, password = your Resend API key, sender = an address on your verified domain.
- **Brute-force protection**: Supabase Auth rate-limits sign-in attempts per IP on the server (**Authentication → Rate Limits**;
  keep the defaults or lower them). For stronger protection turn on **Authentication → Attack Protection → CAPTCHA**
  (hCaptcha or Turnstile); this needs a captcha widget added to the login form, which is not included yet.
  The login form also pauses for 60 seconds (doubling up to 10 minutes) after 5 wrong passwords in 10 minutes in the same
  browser. That is a convenience, not a security control.

## 3. Google sign-in
1. https://console.cloud.google.com → create/select a project.
2. **APIs & Services → OAuth consent screen**: External; app name *CreatorVerse AI*; support email; add your domain and
   `YOUR_PROJECT_REF.supabase.co` as authorized domains; scopes `email`, `profile`, `openid`. Publish the app when ready.
3. **Credentials → Create credentials → OAuth client ID → Web application**
   - Authorized JavaScript origins: `http://localhost:5173`, `https://your-domain`
   - Authorized redirect URI: **`https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`**
4. In Supabase **Authentication → Providers → Google**: enable it and paste the Client ID and Client Secret.
   The secret stays in Supabase. The app checks `/auth/v1/settings` and only enables the Google button when the provider is on.

## 4. Resend (application emails)
1. https://resend.com → **Domains → Add domain**, add the DNS records (SPF/DKIM), and wait for *Verified*.
2. **API Keys → Create** (sending access).
3. Used in step 6 as `RESEND_API_KEY` and `EMAIL_FROM` (for example `CreatorVerse AI <notifications@your-domain.com>`).
   Without a verified domain Resend only delivers to your own Resend account address.
4. **Delivery tracking (for the campaign history's Delivered / Bounced columns)**: **Webhooks → Add endpoint**
   - URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/resend-webhook`
   - Events: `email.delivered`, `email.bounced`, `email.complained`
   - Copy the **signing secret** (`whsec_…`): it becomes `RESEND_WEBHOOK_SECRET`.
   Bounced and spam-complaint addresses are automatically switched off for campaigns.
5. Sending speed: the dispatcher waits `EMAIL_SEND_SPACING_MS` (default 600 ms) between emails to stay under Resend's
   rate limit, and retries failures (see step 7). Each email has an idempotency key, so a retry never sends twice.

### Which emails are sent
| Email | When | Can the user turn it off? |
|---|---|---|
| Welcome | after the email address is verified | no (one-time) |
| Sign-in alert | each later sign-in (not the verification sign-in) | yes, *Sign-in alerts* |
| Collaboration / connection request | when another member sends one | yes, *Campaign activity* |
| New message | a new message, at most once per conversation per hour, never includes the message text | yes, *New messages* |
| Campaigns (news) | when an admin launches one | opt-in only; one-click unsubscribe in every email |
| Security, payment confirmations, payment failures | always | no |

## 5. Razorpay (test mode first)
1. Sign up at https://razorpay.com and stay in **Test Mode**.
2. **Account & Settings → API Keys → Generate test key** to get `RAZORPAY_KEY_ID` (`rzp_test_…`) and `RAZORPAY_KEY_SECRET`.
3. **Subscriptions → Plans → Create plan**: create *Premium Monthly* (every 1 month) and *Premium Yearly* (every 1 year)
   with your prices. Copy each `plan_…` ID.
4. Sign in to CreatorVerse AI as the admin, open **Admin**, and paste the plan IDs (and matching display prices).
   Checkout stays disabled for a plan until its Razorpay plan ID is set.
5. **Account & Settings → Webhooks → Add new webhook**
   - URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/razorpay-webhook`
   - Secret: a long random string (becomes `RAZORPAY_WEBHOOK_SECRET`)
   - Events: `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`,
     `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `subscription.paused`, `subscription.resumed`, `payment.failed`

## 6. Edge Functions (server code with the secrets)
```bash
copy supabase\.env.functions.example supabase\.env.functions   # then fill it in
npx -y supabase secrets set --env-file supabase/.env.functions
npx -y supabase functions deploy create-subscription
npx -y supabase functions deploy verify-subscription
npx -y supabase functions deploy cancel-subscription
npx -y supabase functions deploy razorpay-webhook --no-verify-jwt
npx -y supabase functions deploy email-dispatch --no-verify-jwt
npx -y supabase functions deploy resend-webhook --no-verify-jwt
```
`resend-webhook` and `razorpay-webhook` are called by those services (not by signed-in users), so they skip the JWT
check and instead verify each request's signature with their webhook secret.
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase automatically; the service-role key never leaves Supabase.

## 7. Email delivery trigger and scheduled jobs
1. **Database → Webhooks → Create a new hook**: table `email_outbox`, event **Insert**, type **Supabase Edge Functions**,
   function `email-dispatch`, method POST, add HTTP header `x-dispatch-secret: <EMAIL_DISPATCH_SECRET>`.
2. **Database → Extensions**: enable `pg_cron` and `pg_net`, then in SQL Editor:
   ```sql
   -- marks lapsed subscriptions as expired (3-day grace) and notifies users
   select cron.schedule('expire-subscriptions', '0 3 * * *', $$ select public.expire_subscriptions() $$);
   -- retries failed / missed emails every 10 minutes
   select cron.schedule('email-retry', '*/10 * * * *', $$
     select net.http_post(
       url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/email-dispatch',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', 'YOUR_EMAIL_DISPATCH_SECRET'),
       body := '{}'::jsonb) $$);
   -- deletes login records older than login_events_retention_days (default 180)
   select cron.schedule('purge-login-events', '30 3 * * *', $$ select public.purge_login_events() $$);
   ```
   Campaign emails go through the same outbox, so the email-dispatch webhook and the retry job are what actually send them.
3. Optional: change `report_timezone` (default `Asia/Kolkata`) under **Admin → Feature & billing settings** to show
   analytics and the Excel report in another time zone.

## 8. Run
```bash
npm install
npm start
```
Then open http://localhost:5173. On Vercel, set `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `APP_BASE_URL` as project
environment variables (served by `api/config.js`), and update the Site URL, redirect URLs and Google origins to the deployed domain.

---

## Testing checklist
Automated (no accounts needed): `npm test` runs the SQL migration in PGlite (RLS, quotas, roles, outbox), the Deno unit
tests (signatures, email templates), type-checks every Edge Function, and scans browser files for secrets.

With real services:
1. **Sign up** → you land on *Check your inbox*. Confirm via the link **or** the 6-digit code. You should receive the *Welcome* email.
2. **Resend**: on the Verify page, the button is rate-limited for 60 seconds.
3. **Log in / out / refresh**: the session survives a refresh, and Sign out returns you to the home page.
4. **Forgot password** → email link → *Choose a new password* → a *Password changed* security email arrives.
5. **Google**: *Continue with Google* → consent → you return signed in (first time: choose an account type).
6. **RLS**: with two accounts, confirm account B can't see A's draft campaigns, saved creators or billing.
   In SQL Editor, `select * from public.subscriptions` as a normal user via the API returns only their own row.
7. **Free limits**: do 5 searches → the 6th opens the upgrade dialog; the 4th sends a usage-warning email (80%).
   Save 5 creators → the 6th is refused by the database. Create 1 campaign → the 2nd is refused.
8. **Payments (test mode)**: Pricing → *Upgrade* → Razorpay Checkout (test). Use Razorpay's documented test cards or test UPI ID.
   The success page waits for server verification. Check that `subscriptions.status = 'active'`, the *Premium is active* email
   arrives, and limits rise. Billing → *Cancel* → *will not renew*. In the Razorpay dashboard, **Webhooks → resend** an event and
   confirm `payment_events` has a single row (idempotent).
9. **Failed payment**: use a failing test card. You get a *Payment failed* notification and no Premium.
10. **Emails**: `select template, status, last_error from public.email_outbox order by created_at desc;`
11. **Secrets**: `npm run check:secrets`, and confirm `.env` / `supabase/.env.functions` are not committed.
12. **Login records**: sign in once correctly and once with a wrong password. In **Admin → Login & user analytics** both
    appear under *Login records* (the failure marked *browser report*), and the metrics and charts include them.
13. **Excel**: click **Download Login Excel**. `CreatorVerse_Login_Analytics.xlsx` opens with four sheets: *Login Records*
    (one row per event in the filtered period), *User Summary*, *Daily Analytics* and *Role Analysis*. Change the role,
    status or date filters and download again; the rows change to match.
14. **Sign-in alert**: sign in again, then check the inbox (and `email_outbox` for `template = 'login_alert'`). Turn off
    *Sign-in alerts* in Account settings and sign in again: no new alert.
15. **Campaign**: tick the news opt-in at sign-up (or in Account settings) on a test account. In **Admin → Email Campaigns**
    pick the audience, check the eligible count, *Preview*, *Send test to me*, then *Launch campaign…* and type `SEND`.
    History shows queued → sent (and delivered/bounced once the Resend webhook is set). Click *Unsubscribe* in the received
    email: the account's news setting turns off and it is excluded from the next campaign.
