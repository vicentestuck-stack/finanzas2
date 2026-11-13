# Finsy backend

This is the only piece of Finsy that runs on a server. It exists for one
reason: it holds the Fintoc **secret** key, which must never sit inside the
downloadable app (anyone could extract it and read other people's bank
accounts with it). Everything else — viewing your balance, transactions,
budgets, chat — stays in the app's local storage and works with no
internet at all.

## What you need to create (free tiers are enough to start)

1. **Supabase project** — https://supabase.com → New project.
   - In the SQL editor, run the file `../replica/schema.sql` once. This
     creates every table, the Row Level Security policies, and the default
     categories.
   - Settings → API: copy the **Project URL**, the **anon public key**, and
     the **service_role key** (keep the service_role key secret — it goes
     in this backend only, never in the app).
   - Settings → Auth → make sure "Enable email provider" is on (it is by
     default). You can turn off "Confirm email" while testing, so sign-up
     logs you in immediately.

2. **Fintoc account** — https://fintoc.com → sign up → dashboard.
   - API Keys page: copy the **test** public key (`pk_test_...`) and
     **test** secret key (`sk_test_...`). Stay in test mode until you're
     ready to connect a real bank — test mode connects to a fake
     institution with fake data, so you can build and verify the whole
     flow without touching a real account.
   - Docs used to build this integration: Fintoc's Link Intents API,
     the widget integration guide, and the movements list endpoint
     (https://docs.fintoc.com).

3. **Vercel account** (to deploy this folder) — https://vercel.com.

## Deploy

```bash
cd finsy-clone/backend
npm install
```

Install the Vercel CLI once if you don't have it, then deploy from this
folder:

```bash
npx vercel
```

Follow the prompts (link or create a project). Then set the environment
variables Vercel will ask you to confirm — either during `vercel` setup or
afterwards in the dashboard (Project → Settings → Environment Variables),
using the names in `.env.example`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FINTOC_SECRET_KEY`
- `ALLOWED_ORIGIN` — the URL where you host the Finsy app (the PWA). `*`
  works while testing locally.

Redeploy after adding/changing env vars:

```bash
npx vercel --prod
```

You'll get a URL like `https://finsy-backend-xxxx.vercel.app`. That is the
`BACKEND_URL` to paste into `finsy-clone/pwa/index.html`'s `CLOUD_CONFIG`
(see the top of that file's `<script>`), together with the Supabase URL,
the Supabase **anon** key, and the Fintoc **public** key (the public ones
are safe to ship inside the app, same idea as a Stripe publishable key).

## Routes

| route | what it does |
| --- | --- |
| `POST /api/fintoc/link-intent` | creates a Fintoc Link Intent, returns a short-lived `widgetToken` the app uses to open the Fintoc widget |
| `POST /api/fintoc/exchange` | exchanges the widget's `exchangeToken` for the real `link_token`, stores the bank connection + accounts in Supabase |
| `POST /api/sync` | pulls new movements from Fintoc for every connected account, stores them, returns the user's transactions |
| `GET /api/bank/status` | tells the app whether a bank is already connected |
| `DELETE /api/bank/disconnect` | marks a connection as disconnected (stops syncing it) |

Every route requires `Authorization: Bearer <supabase_access_token>` — the
app gets that token from `supabase.auth.signIn...` and sends it along.

## Known simplifications (fine for a first version, worth revisiting later)

- Account balances are only recorded at connect time, not refreshed on
  every sync (no verified "refresh balance" endpoint was wired in yet).
- Disconnecting a bank only stops *our* syncing; it does not yet call
  Fintoc to deactivate the link on their side — check their current
  "deactivate a link" endpoint before this goes in front of real users.
- Transaction categories are only guessed locally in the app (same
  keyword-matching it already used for manual/chat entries); the backend
  doesn't categorize or store a category for bank-synced rows yet.
