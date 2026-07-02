# Finance Tracker — Дневник финансов

Личный трекер доходов и расходов. Telegram Mini App на React + Vite,
Supabase (Postgres) + Vercel Serverless.

Отличие от трекеров тренировок/питания — **повышенная безопасность**:

1. **Настоящий Supabase Auth.** Вход через Telegram: `api/tg-auth.js`
   проверяет подпись `initData` (HMAC-SHA256 по токену бота), провижнит
   пользователя в `auth.users` и через Admin API выдаёт реальную
   Supabase-сессию. RLS работает по `auth.uid()`.
2. **RLS закрыт.** Политики только `to authenticated`, `user_id = auth.uid()`.
   Роль `anon` не имеет доступа ни к чему — даже с anon-ключом из фронта
   без валидной сессии нельзя прочитать ни строки. (В трекерах было
   `using(true)`.)
3. **Шифрование на клиенте.** Сумма, категория и заметка шифруются в
   браузере (AES-GCM, WebCrypto) и лежат в БД только как шифротекст
   (`enc` + `iv`). Ключ (256 бит) хранится в **Telegram CloudStorage**,
   синхронизируется между устройствами и никогда не попадает на сервер.
   Открытыми в БД остаются только `occurred_at`, `kind`, `currency`.

Компромисс (осознанный): в доверенный периметр входит Telegram (ключ
проходит через CloudStorage). От утечки БД / anon-ключа защищает
полностью; от компрометации Telegram-аккаунта — нет.

## Стек и структура

```
finance-tracker/
├── api/
│   └── tg-auth.js         — мост Telegram initData -> Supabase Auth (magic-link)
├── src/
│   ├── App.jsx            — весь UI (AuthGate, операции, статистика)
│   ├── main.jsx
│   ├── supabaseClient.js
│   └── lib/
│       └── crypto.js      — AES-GCM + ключ в Telegram CloudStorage
├── supabase/
│   └── schema.sql         — таблицы + RLS по auth.uid()
├── index.html             — подключает Telegram WebApp SDK
├── package.json
└── vite.config.js
```

## Переменные окружения (Vercel: Production + Preview)

| Переменная | Где используется | Секретность |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | фронт + api | публичная |
| `VITE_SUPABASE_ANON_KEY` | фронт | публичная (anon) |
| `SUPABASE_SERVICE_ROLE_KEY` | только `api/` | **секрет**, не во фронт |
| `TELEGRAM_BOT_TOKEN` | только `api/tg-auth.js` | **секрет** |

`VITE_SUPABASE_URL` — только базовый домен, без `/rest/v1/`.

## Развёртывание

1. В Supabase (проект Finance Tracker) выполнить `supabase/schema.sql`
   в SQL Editor (идемпотентен). RLS уже включён скриптом.
2. Создать проект на Vercel из этого репозитория, выставить 4 env на
   Production и Preview, задеплоить.
3. В BotFather: создать бота, в его настройках Mini App / Menu Button
   указать **стабильный продакшн-домен** Vercel (не preview-хэш).
4. Открыть Mini App через бота.

## Данные

- `transactions` — операции. Открыто: `occurred_at`, `kind` (income/expense),
  `currency`. Зашифровано (в `enc`/`iv`): `{ amount, category, note }`.
- `app_settings` — по одной строке на пользователя, зашифрованный список
  категорий и настройки.

Все суммы, разбивки по категориям и валютам считаются **на клиенте**
после расшифровки — сервер сумм не видит.
