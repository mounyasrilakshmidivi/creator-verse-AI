# CreatorVerse AI

**Creators × Brands × AI** · *Create with AI. Sell with Confidence. Grow Together.*

A creator marketplace: brands discover creators, run AI matching, publish campaigns and review applications. Creators
publish profiles and apply. Accounts, data, plan limits, emails and Premium subscriptions are backed by real services.

> The featured creator directory is **fictional sample data**. Member accounts, creator profiles, campaigns,
> applications, requests and subscriptions are real database records once the backend is configured.

## Quick start
```bash
npm install
npm start          # http://localhost:5173
npm test           # database + Edge Function tests, type-check, secret scan
```
Without configuration the site runs in browse-only mode and shows "Setup required" for accounts and payments.
**To connect Supabase, Resend, Razorpay and Google, follow [SETUP.md](SETUP.md).**

## Architecture
```
Browser (static HTML/CSS/JS, no build step)
  │  supabase-js (anon key only) ── Supabase Auth: email+password, email verification, reset, Google OAuth
  │                               └ PostgREST → Postgres with Row Level Security + triggers
  │  /api/config ── serve.ps1 (or api/config.js on Vercel): exposes ONLY public config
  └─ Edge Functions (Deno, hold all secrets)
       create-subscription · verify-subscription · cancel-subscription → Razorpay API
       razorpay-webhook (HMAC-verified, idempotent) → subscriptions
       email-dispatch ← Database Webhook on email_outbox → Resend
       resend-webhook (Svix-signed) → delivered / bounced / complained status
```
- **Plan limits** live in `plan_limits` (admin-editable). Campaign and saved-creator limits are enforced by database
  triggers. Profile views, searches and AI matches are counted by the `consume_quota` database function before the UI proceeds.
- **Premium** is granted only by rows the Edge Functions write after Razorpay confirms the payment, either through the
  API (`verify-subscription`) or a signed webhook. A frontend redirect never grants access.
- **Emails** are queued by database triggers only after the action actually committed. They are de-duplicated with
  unique keys and sent with a Resend idempotency key. Delivery status is stored per row, and a failed email never affects app data.
- **Login records**: successful sign-ins are recorded by a database trigger on Supabase Auth; failed attempts are reported
  by the browser after Supabase rejects them (rate-limited, never with the password). Only admins can read them; they are
  purged after 180 days.
- **Admin analytics & Excel**: metrics, charts and insights come from the `admin_login_report` function. The Excel file
  is built in the admin's browser with ExcelJS (`js/vendor/exceljs-4.4.0.min.js`, loaded only when clicked).
- **Email campaigns** go only to verified, active users who opted in. Each recipient gets an individual email with a
  one-click unsubscribe link; bounces and complaints switch campaigns off for that address.
- **Admins** are rows in `app_admins` (SQL only). The Admin page edits limits, plans and settings, and RLS rejects these edits for everyone else.

## Pages
| Route | Purpose |
|---|---|
| `#/` | Landing page |
| `#/explore`, `#/creator/:id` | Marketplace (metered searches and profile views; Premium-only advanced filters) |
| `#/match` | AI Matching: transparent rule-based score, optional AI-written recommendation (metered) |
| `#/campaigns` | Campaign board, create campaigns, review applications, apply as a creator |
| `#/signup`, `#/login`, `#/verify`, `#/forgot`, `#/reset`, `#/onboarding` | Authentication and onboarding |
| `#/dashboard`, `#/account`, `#/notifications`, `#/saved` | Signed-in area |
| `#/pricing`, `#/billing`, `#/payment/success`, `#/payment/cancelled` | Plans, Razorpay checkout, subscription management |
| `#/admin` | Admin dashboard: users and approvals, login & user analytics, **Download Login Excel**, Email Campaigns, limits, plans and settings (admins only) |
| `#/members`, `#/u/:id`, `#/requests`, `#/connections` | Member directory, profiles, collaboration requests and connections |
| `#/unsubscribe` | One-click unsubscribe from news emails (opened from the email link) |
| `#/studio/posts` | AI Content Studio (captions, scripts, ad copy; English, Hindi, Telugu) |
| `#/messages` | Member-to-member messages (real-time), plus the demo chat with AI-simulated sample creators |

## Project structure
```
index.html, css/, js/          front end (js/backend.js = Supabase client, js/account.js = auth/billing screens)
js/vendor/supabase-*.js        supabase-js browser bundle (served locally)
supabase/migrations/           schema, RLS, quotas, triggers, seed plans (sample prices)
supabase/functions/            Edge Functions + shared Razorpay/Resend code + Deno tests
supabase/templates/            branded Supabase Auth email templates
tests/*.test.mjs               run the migrations in PGlite and test RLS, quotas, notifications, network, emails, campaigns and the login report
tests/ui-mock.js               dev-only in-memory backend for smoke-testing the UI
serve.ps1, api/                local server/proxy and Vercel functions (AI proxy, public config)
```
