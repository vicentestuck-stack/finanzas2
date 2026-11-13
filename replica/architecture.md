# Architecture: Finsy (a rebuild of savemoney.cl's core features)

Path note: this lives entirely under `finsy-clone/replica/`, separate from
the unrelated SNOW-clone project in `replica/` at the project root.

## Stack

| layer | choice | why |
| --- | --- | --- |
| web dashboard + marketing site | Next.js (App Router) + TypeScript | one codebase for the public site and the logged-in web dashboard; server actions remove a separate API layer for most routes |
| mobile app | Expo (React Native) | this is a mobile-first product — push notifications, camera for receipts, and over-the-air updates are cheap with Expo; shares types with the web app |
| styling | Tailwind, tokens from the Finsy design concept (dark navy/indigo, `#6C7CFF` accent) | matches the Design-canvas mockup already built this session |
| database | Postgres on Supabase | Postgres + Auth + Storage + Row Level Security bundled; RLS is the right fit for a finance app where every row must be provably scoped to one user |
| ORM | Drizzle | type-safe SQL without hiding the schema; easy to pair with Supabase's connection pooler |
| auth | Supabase Auth (email/password + Google/Apple OAuth) | `auth.uid()` plugs straight into Postgres RLS policies, no second auth system to keep in sync |
| **bank connection** | **Fintoc** (Chilean/LatAm account-aggregation API, sandbox + production) | a licensed aggregator — Finsy never sees or stores the user's real bank password; the bank login happens inside Fintoc's own hosted widget, and Fintoc sends us tokens + transaction webhooks only |
| AI assistant | Anthropic Claude API, tool-calling | the model gets read tools (query the user's own transactions/budgets) and write tools (log an expense, change a category) — it never gets raw database access, and every number it states must come from a tool result, not from its own math |
| receipt capture | Claude's vision input (the receipt photo is sent as an image message) | no separate OCR vendor needed for v1; revisit only if accuracy is a problem in testing |
| files | Supabase Storage | receipt photos, private bucket, one folder per user |
| background jobs | Supabase Edge Functions + `pg_cron`, or Trigger.dev if the logic outgrows SQL/Deno | nightly re-sync safety net in case a webhook was missed, and the budget-alert check |
| push notifications | Expo Push service | budget alerts, sync failures |
| hosting | Vercel (web), EAS (mobile builds), Supabase (db/auth/storage/functions) | each piece stays managed; no servers to run |
| payments (phase 2, not in this slice) | Stripe Billing | only needed once there's a paid tier to gate — not part of the vertical slice |

One database. No microservices. Finsy does not need savemoney.cl's internal
architecture, only its features — and the one feature that is NOT rebuilt
in-house is the bank connection itself: that is Fintoc's job, by design.

## Schema

Tables: 8 (`profiles`, `bank_connections`, `accounts`, `transactions`,
`categories`, `budgets`, `chat_messages`, `receipt_uploads`). Access rules:
**Postgres Row Level Security on every table**, policy `user_id = auth.uid()`
for select/insert/update/delete — chosen over data-layer checks because a
finance app should not depend on every query remembering to filter by user;
the database refuses the row instead.

```sql
-- finsy-clone/replica/schema.sql holds the full file; key tables below.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'America/Santiago',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table profiles enable row level security;
create policy "own profile" on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

create table bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'fintoc',
  provider_link_token text not null,       -- Fintoc's "link_intent"/link id, not a bank password
  institution_name text not null,
  status text not null default 'active'
    check (status in ('active','error','disconnected')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on bank_connections (user_id);
alter table bank_connections enable row level security;
create policy "own bank connections" on bank_connections for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table accounts (
  id uuid primary key default gen_random_uuid(),
  bank_connection_id uuid not null references bank_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_account_id text not null,
  type text not null check (type in ('checking','savings','credit_card')),
  last4 text,
  currency text not null default 'CLP',
  current_balance_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_connection_id, provider_account_id)
);
create index on accounts (user_id);
alter table accounts enable row level security;
create policy "own accounts" on accounts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade, -- null = system default category
  name text not null,
  icon text not null default 'tag',
  parent_category_id uuid references categories(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on categories (user_id);
alter table categories enable row level security;
create policy "own or default categories" on categories for select
  using (user_id = auth.uid() or user_id is null);
create policy "manage own categories" on categories for insert with check (user_id = auth.uid());
create policy "update own categories" on categories for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own categories" on categories for delete using (user_id = auth.uid());

create table transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_transaction_id text,              -- null for manual entries
  posted_at timestamptz not null,
  amount_cents bigint not null,              -- negative = expense, positive = income
  currency text not null default 'CLP',
  raw_description text not null,
  clean_description text,
  category_id uuid references categories(id) on delete set null,
  source text not null default 'bank_sync'
    check (source in ('bank_sync','manual','receipt_photo','voice_note')),
  receipt_upload_id uuid references receipt_uploads(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  unique (account_id, provider_transaction_id)
);
create index on transactions (user_id, posted_at desc);
create index on transactions (category_id);
alter table transactions enable row level security;
create policy "own transactions" on transactions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  month date not null,                       -- always the 1st of the month, in the user's timezone
  cap_cents bigint not null check (cap_cents > 0),
  created_at timestamptz not null default now(),
  unique (user_id, category_id, month)
);
create index on budgets (user_id, month);
alter table budgets enable row level security;
create policy "own budgets" on budgets for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  linked_transaction_id uuid references transactions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on chat_messages (user_id, created_at);
alter table chat_messages enable row level security;
create policy "own chat messages" on chat_messages for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table receipt_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  parsed_amount_cents bigint,
  parsed_merchant text,
  status text not null default 'pending'
    check (status in ('pending','parsed','failed')),
  created_at timestamptz not null default now()
);
create index on receipt_uploads (user_id);
alter table receipt_uploads enable row level security;
create policy "own receipts" on receipt_uploads for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Money is always integer cents (`*_cents`) plus a `currency` column — never a
float. All timestamps are `timestamptz`, stored in UTC; a user's "month" for
budgeting is computed from `profiles.timezone`, not from server time.

## API

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| `POST /api/bank/link-token` | asks Fintoc for a short-lived link token to start the connect widget | authenticated user | — | `{ linkToken }` | F01 step 2 |
| `(client-side)` Fintoc Connect widget | user picks their bank and logs in **inside Fintoc's hosted UI** | the user, never our server | — | a Fintoc `link_token`/account id back to our client | F01 step 3 |
| `POST /api/bank/connections` | exchanges the Fintoc link result for a `bank_connections` row and kicks off the first sync | authenticated user | `{ fintocLinkId }` | `{ bankConnectionId, status }` | F01 step 4 |
| `POST /api/webhooks/fintoc` | receives new/updated transactions and balance changes | Fintoc (signed webhook) | Fintoc payload | `200 OK` | F01 ongoing sync |
| `GET /api/accounts` | list the user's linked accounts + balances | authenticated user | — | `Account[]` | S04, S10 |
| `GET /api/transactions?month=&category=&q=` | paginated transaction list | authenticated user | query params | `Transaction[]` | S05 |
| `PATCH /api/transactions/:id` | correct category/merchant/notes | authenticated user, own row only (RLS) | `{ categoryId?, notes? }` | updated `Transaction` | S06, F04 edge case |
| `GET /api/budgets?month=` | this month's budgets + spend so far | authenticated user | query param | `Budget[]` with computed `spent_cents` | S07 |
| `PUT /api/budgets` | create/update a category's budget for a month | authenticated user | `{ categoryId, month, capCents }` | `Budget` | F04 |
| `POST /api/expenses/manual` | log a manual transaction (cash, or typed from chat) | authenticated user | `{ amountCents, categoryId, postedAt, note? }` | `Transaction` | S09, F03 |
| `POST /api/receipts` | upload a receipt photo, parse it with Claude's vision, create a pending transaction | authenticated user | multipart image | `{ receiptUploadId, parsedAmountCents, parsedMerchant }` | F03 |
| `POST /api/chat` | send a chat message; server calls Claude with read/write tools scoped to that user | authenticated user | `{ message }` | streamed `ChatMessage` (assistant) | F02, F03 |
| `DELETE /api/bank/connections/:id` | revoke the Fintoc token and mark the connection disconnected | authenticated user, own row only | — | `{ status: "disconnected" }` | S10 |
| `DELETE /api/account` | delete the user's data: revoke all bank tokens, purge rows, delete auth user | authenticated user | confirmation flag | `{ status: "deleted" }` | S10, GDPR/data-deletion |

Webhooks in: `fintoc` (new transaction, balance update, connection error).
Webhooks out: none yet (Stripe webhooks arrive in phase 2 with billing).
Jobs: `nightly-resync` (cron, 03:00 user-local) — re-pulls the last 7 days per
active connection as a safety net for missed webhooks; `budget-alert-check`
(cron, hourly) — finds budgets crossing 80%/100% since the last check and
queues a push notification.

## The parts that bite

- **time zones:** a "month" for budgeting is the user's local calendar
  month (`profiles.timezone`), not UTC — a transaction posted at 11pm on the
  31st in Santiago must not land in the wrong month because the server is in
  UTC.
- **idempotency:** Fintoc (like any aggregator) can and will redeliver the
  same webhook. `unique (account_id, provider_transaction_id)` on
  `transactions` makes a duplicate insert a no-op, not a double-counted
  expense.
- **races:** the nightly re-sync job and a live webhook can both try to
  insert the same transaction at once — the same unique constraint covers
  it; budget "spent so far" is always computed on read (a query, not a
  stored running total), so there is nothing to get out of sync.
- **rate limits:** both Fintoc and the Claude API have rate limits; the chat
  endpoint should queue/backoff rather than fail a user's message outright,
  and bank re-syncs should stagger rather than fire all connections at once.
- **file size limits:** receipt photos capped client-side (e.g. 8 MB) before
  upload to Supabase Storage.
- **search:** a simple `ILIKE` on `clean_description`/`raw_description` is
  enough at personal-finance scale; add a trigram index only if it's ever
  slow.
- **realtime:** not needed for the vertical slice; Supabase Realtime on
  `transactions` is a cheap add later for "your transaction just landed"
  without a manual refresh.
- **offline:** the mobile app should let a manual expense be entered while
  offline and queue it (local store) until it can `POST
  /api/expenses/manual`, since "anota un gasto" working offline is part of
  the pitch.
- **email deliverability:** only Supabase Auth's own emails (confirm,
  reset) matter in this slice; no marketing email sending yet.
- **multi-tenancy:** not applicable in this slice (one user per account);
  the "later" shared/household feature will need a `household_members`
  join table and RLS policies that check membership, not just `user_id`.
- **GDPR / data deletion:** `DELETE /api/account` must actually revoke the
  Fintoc token (not just stop polling it) and hard-delete PII — a user who
  disconnects their bank should be able to trust that Finsy can no longer
  read it.

## Build order

1. **Vertical slice:** sign up (S02) → connect one real/sandbox bank through
   Fintoc (S03) → land on a plain transaction list pulled from that bank
   (a minimal S04/S05) → set one category budget (S07). Tables: `profiles`,
   `bank_connections`, `accounts`, `transactions`, `categories` (seeded
   defaults), `budgets`. Routes: `link-token`, `bank/connections`,
   `webhooks/fintoc`, `GET /transactions`, `PUT /budgets`. This alone proves
   the riskiest part — the aggregator integration, auth, and RLS — end to
   end before any AI or polish work starts.
2. **Must-haves** (`features.csv` priority = must): auto-categorization,
   cleaned merchant names, the real home dashboard (S04), the read-only chat
   assistant (S08, `POST /api/chat` with read-only tools first).
3. **Should-haves:** manual/voice/receipt-photo expense logging (S09,
   `POST /api/expenses/manual`, `POST /api/receipts`, chat write-tools),
   category correction (S06, `PATCH /transactions/:id`), budget alerts
   (`budget-alert-check` job), upcoming/recurring payments view, bank
   disconnect and account deletion (S10).
4. **Could-haves:** shared/household accounts, "me deben" bill-splitting,
   card-installment tracking, the discounts map (needs its own merchant
   deals first — see recon's Out of scope).
5. **Fixes from `/replica-entrepreneur`**, once it has run — not yet done
   for this project.
