-- ZeroWaste AI initial PostgreSQL schema (run in Supabase SQL Editor)
create extension if not exists pgcrypto;

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password text not null,
  role text not null check (role in ('user','business','admin')),
  subscription_wallet text,
  subscription_expires_at timestamptz,
  subscription_tx_hash text,
  user_type text check (user_type in ('citizen','social_case')),
  business_name text,
  phone text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists offers (
  id uuid primary key default gen_random_uuid(),
  chain_offer_id text not null unique,
  contract_address text not null,
  details_hash text not null,
  merchant_account uuid not null references accounts(id),
  merchant_name text not null,
  merchant_wallet text,
  merchant_signature text,
  subscription_expires_at timestamptz not null,
  title text not null,
  count text not null,
  price numeric not null check(price >= 0),
  original_price numeric not null check(original_price >= 0),
  price_wei text not null,
  quantity integer not null check(quantity between 1 and 500),
  available_units integer not null check(available_units >= 0),
  pickup_deadline timestamptz not null,
  image text not null default '',
  chain_tx_hash text,
  status text not null default 'draft' check(status in ('draft','pending','active','soldout','closed','rejected')),
  admin_decision_reason text,
  admin_reviewed_at timestamptz,
  admin_reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchase_intents (
  id uuid primary key default gen_random_uuid(),
  intent_id text not null unique,
  offer uuid not null references offers(id),
  customer_account uuid not null references accounts(id),
  customer_wallet text not null,
  status text not null default 'creating' check(status in ('creating','pending','confirmed','cancelled','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  contract_reservation_id text not null unique,
  chain_reservation_id text not null,
  contract_address text not null,
  chain_offer_id text not null,
  offer uuid not null references offers(id),
  customer_account uuid not null references accounts(id),
  customer_wallet text not null,
  ticket_token text not null unique,
  amount_paid_wei text not null,
  payment_method text not null default 'marketplace_escrow',
  chain_tx_hash text not null,
  completion_tx_hash text,
  refund_tx_hash text,
  status text not null default 'active' check(status in ('active','completed','cancelled','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists offers_status_created_idx on offers(status, created_at desc);
create index if not exists offers_merchant_idx on offers(merchant_account);
create index if not exists reservations_customer_idx on reservations(customer_account);
create index if not exists intents_expiry_idx on purchase_intents(status, expires_at);

alter table accounts enable row level security;
alter table offers enable row level security;
alter table reservations enable row level security;
alter table purchase_intents enable row level security;
