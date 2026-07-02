// Клиентское шифрование чувствительных данных (AES-GCM, WebCrypto).
//
// Модель: суммы/категории/заметки шифруются В БРАУЗЕРЕ перед отправкой в
// Supabase. В БД лежит только шифротекст. Ключ (256 бит) хранится в
// Telegram CloudStorage — синхронизируется между устройствами пользователя
// средствами Telegram и НИКОГДА не уходит на наш сервер / в Supabase.
//
// Осознанный компромисс (согласован): в доверенный периметр входит Telegram
// (ключ проходит через CloudStorage). От утечки БД / anon-ключа защищает
// полностью; от компрометации Telegram-аккаунта — нет.

const KEY_NAME = 'fin_enc_key_v1';
const cloud = () => window.Telegram?.WebApp?.CloudStorage;

const b64 = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  dec: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
};

// --- Telegram CloudStorage как промисы ---
function cloudGet(key) {
  return new Promise((resolve, reject) => {
    const cs = cloud();
    if (!cs) return reject(new Error('CloudStorage недоступен (открой приложение внутри Telegram)'));
    cs.getItem(key, (err, value) => (err ? reject(new Error(err)) : resolve(value || null)));
  });
}

function cloudSet(key, value) {
  return new Promise((resolve, reject) => {
    const cs = cloud();
    if (!cs) return reject(new Error('CloudStorage недоступен'));
    cs.setItem(key, value, (err, ok) => (err ? reject(new Error(err)) : resolve(ok)));
  });
}

let cachedKey = null;

// Возвращает CryptoKey; при первом входе генерирует и сохраняет его в CloudStorage.
export async function getKey() {
  if (cachedKey) return cachedKey;

  let raw = await cloudGet(KEY_NAME);
  let isNew = false;

  if (!raw) {
    const bytes = crypto.getRandomValues(new Uint8Array(32)); // 256 бит
    raw = b64.enc(bytes);
    await cloudSet(KEY_NAME, raw);
    isNew = true;
  }

  cachedKey = await crypto.subtle.importKey(
    'raw',
    b64.dec(raw),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  cachedKey.__isNew = isNew;
  return cachedKey;
}

// Проверка, что ключ уже есть (для UX «первый вход» / резервной копии)
export async function keyExists() {
  const raw = await cloudGet(KEY_NAME);
  return Boolean(raw);
}

// Экспорт ключа в base64 — на случай, если пользователь захочет сделать
// офлайн-резервную копию (потеря Telegram-аккаунта = потеря доступа к данным).
export async function exportKeyBase64() {
  const raw = await cloudGet(KEY_NAME);
  return raw;
}

// --- Шифрование / расшифровка произвольного JSON-объекта ---
export async function encryptObject(obj) {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { enc: b64.enc(ct), iv: b64.enc(iv) };
}

export async function decryptObject({ enc, iv }) {
  const key = await getKey();
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64.dec(iv) },
    key,
    b64.dec(enc)
  );
  return JSON.parse(new TextDecoder().decode(pt));
}
