-- Run this in your Supabase SQL editor

-- Session state (replaces in-memory store)
create table if not exists sessions (
  phone text primary key,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Reservations
create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  reservation_id text unique not null,
  phone text not null,
  name text,
  party_size integer,
  date date,
  time time,
  branch text,
  notes text,
  created_at timestamptz not null default now()
);

-- Handoff requests
create table if not exists handoffs (
  id uuid primary key default gen_random_uuid(),
  handoff_id text unique not null,
  phone text not null,
  summary text,
  branch text,
  status text default 'PENDING',
  created_at timestamptz not null default now()
);

-- Intent analytics
create table if not exists analytics (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  intent text not null,
  branch text,
  message text,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists analytics_intent_idx on analytics(intent);
create index if not exists analytics_created_idx on analytics(created_at);
create index if not exists reservations_phone_idx on reservations(phone);
create index if not exists handoffs_status_idx on handoffs(status);
