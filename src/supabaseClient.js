import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anon);

// Anon-ключ лежит во фронте (это нормально для Supabase), но, в отличие от
// трекеров, RLS закрыт по auth.uid() и роль anon не имеет доступа к данным —
// без валидной Auth-сессии этот клиент не прочитает ни одной строки.
export const supabase = supabaseConfigured
  ? createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'fin-auth',
      },
    })
  : null;
