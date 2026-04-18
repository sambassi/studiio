-- Chat logs for Studiio Assistant analytics
-- Run in Supabase SQL Editor

create table if not exists chat_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  locale text not null default 'fr',
  user_message text not null,
  assistant_message text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_logs_user_id_idx on chat_logs (user_id, created_at desc);
