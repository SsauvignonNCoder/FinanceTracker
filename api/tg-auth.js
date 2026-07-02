// Vercel Serverless Function: POST /api/tg-auth
//
// Мост Telegram Mini App -> НАСТОЯЩИЙ Supabase Auth.
// 1. Проверяет подпись initData (HMAC-SHA256 по секрету бота) — официальный
//    алгоритм Telegram. Клиенту доверять нельзя, подпись валидируем на сервере.
// 2. По telegram_id находит/создаёт пользователя в auth.users (service role).
// 3. Через Admin API генерирует одноразовый magic-link token_hash и отдаёт его
//    фронту. Фронт делает supabase.auth.verifyOtp(...) и получает НАСТОЯЩУЮ
//    Supabase-сессию, после чего RLS работает по auth.uid().
//
// Так «вход только через Telegram» совмещается с полноценным Auth + RLS —
// в отличие от трекеров, где возвращался «голый» user_id и RLS был открыт.

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_AGE_SEC = 86400; // initData не старше 24 часов

function verifyInitData(initData) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const pairs = [];
  for (const [k, v] of params.entries()) pairs.push(`${k}=${v}`);
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Сравнение постоянного времени
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SEC) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;
  try {
    return JSON.parse(userRaw);
  } catch {
    return null;
  }
}

// Детерминированный «служебный» email по telegram_id (реальная почта не нужна).
const emailFor = (tgId) => `tg_${tgId}@finance.local`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!BOT_TOKEN || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Сервер не настроен — проверь переменные окружения' });
  }

  const { initData } = req.body || {};
  if (!initData || typeof initData !== 'string') {
    return res.status(400).json({ error: 'Не передан initData' });
  }

  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'Подпись initData не подтверждена' });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const email = emailFor(tgUser.id);
  const displayName =
    [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') ||
    tgUser.username ||
    'Пользователь';

  try {
    // Идемпотентно обеспечиваем существование пользователя.
    // createUser вернёт ошибку, если уже есть — это ок, игнорируем.
    await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: crypto.randomBytes(24).toString('hex'),
      user_metadata: { telegram_id: tgUser.id, display_name: displayName },
    });

    // Генерируем одноразовый magic-link token_hash для входа.
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    if (error) throw error;

    const tokenHash = data?.properties?.hashed_token;
    if (!tokenHash) throw new Error('Не удалось получить token_hash');

    return res.status(200).json({ ok: true, token_hash: tokenHash, displayName });
  } catch (e) {
    return res
      .status(500)
      .json({ error: 'Не удалось авторизовать пользователя', details: String(e.message || e) });
  }
}
