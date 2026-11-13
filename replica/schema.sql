-- Finsy database schema (Postgres on Supabase)
-- One policy per table: user_id = auth.uid(). The database refuses the row,
-- not the application code.

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
  provider_link_id text not null,
  link_token text not null,          -- Fintoc link_token: can read real transactions.
                                      -- Only ever read/written by the backend's
                                      -- service-role key, never sent to the client.
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
  month date not null,                       -- always the 1st of the month, user-local
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

-- Seed a few default categories shared by every user (user_id is null).
insert into categories (user_id, name, icon) values
  (null, 'Comida', 'utensils'),
  (null, 'Transporte', 'car'),
  (null, 'Vivienda', 'home'),
  (null, 'Entretenimiento', 'film'),
  (null, 'Salud', 'heart'),
  (null, 'Compras', 'shopping-bag'),
  (null, 'Suscripciones', 'repeat'),
  (null, 'Otros', 'tag');
