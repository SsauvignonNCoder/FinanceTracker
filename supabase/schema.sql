-- Finance Tracker — схема БД
-- Ключевое отличие от трекеров тренировок/питания:
--   1. НАСТОЯЩИЙ Supabase Auth: user_id ссылается на auth.users(id).
--   2. RLS строго по auth.uid() и ТОЛЬКО для роли authenticated.
--      Роль anon не имеет доступа ни к чему (в трекерах было using(true)).
--   3. Чувствительные данные лежат ЗАШИФРОВАННЫМИ (столбцы enc/iv) —
--      сервер видит только шифротекст. Ключ шифрования у клиента
--      (Telegram CloudStorage), в БД не попадает никогда.
--
-- Скрипт идемпотентен: можно запускать повторно.

-- ============================================================
-- Таблица транзакций
-- ============================================================
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- ОТКРЫТЫЕ поля (нужны для сортировки/группировки на сервере):
  occurred_at  date not null,
  kind         text not null check (kind in ('income', 'expense')),
  currency     text not null,                    -- ISO-код валюты, напр. 'RUB','USD','EUR'
  -- ЗАШИФРОВАННЫЙ блок {amount, category, note} (AES-GCM, base64):
  enc          text not null,
  iv           text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, occurred_at desc);

-- ============================================================
-- Настройки пользователя (список категорий, валюты, префы) — тоже шифруются
-- Одна строка на пользователя.
-- ============================================================
create table if not exists public.app_settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  enc         text,
  iv          text,
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- Триггер обновления updated_at
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_transactions_updated on public.transactions;
create trigger trg_transactions_updated
  before update on public.transactions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_app_settings_updated on public.app_settings;
create trigger trg_app_settings_updated
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- ============================================================
-- Row Level Security
-- Включаем RLS и НЕ создаём ни одной политики для anon.
-- Все политики — только to authenticated, по auth.uid().
-- ============================================================
alter table public.transactions enable row level security;
alter table public.app_settings enable row level security;

-- transactions
drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists transactions_insert on public.transactions;
create policy transactions_insert on public.transactions
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists transactions_delete on public.transactions;
create policy transactions_delete on public.transactions
  for delete to authenticated
  using (user_id = auth.uid());

-- app_settings
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists app_settings_insert on public.app_settings;
create policy app_settings_insert on public.app_settings
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Явно убираем любые дефолтные гранты для anon (пояс + подтяжки к RLS).
revoke all on public.transactions from anon;
revoke all on public.app_settings from anon;
