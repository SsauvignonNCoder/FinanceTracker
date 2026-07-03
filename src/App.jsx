import React, { useState, useEffect, useMemo, useRef, createContext, useContext, useCallback } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Sector,
} from 'recharts';
import {
  Wallet, Plus, TrendingUp, TrendingDown, Trash2, Pencil, X, Check,
  BarChart3, ListOrdered, ChevronLeft, ChevronRight, Loader2, ShieldCheck,
} from 'lucide-react';
import { supabase, supabaseConfigured } from './supabaseClient.js';
import { getKey, encryptObject, decryptObject } from './lib/crypto.js';

/* ============================================================
   NEO-VECTORHEART · VELOCITY — визуальный редизайн Finance Tracker.
   Чёрная база, янтарь-медь (бренд-акцент) + кислотный лайм (доход),
   диагональная геометрия, скошенные грани, HUD-разметка.
   Логика (auth / Supabase / шифрование / CRUD) не изменена.
   ============================================================ */

// Шрифты-герои экосистемы + дисплейный Exo 2
const FONT_DISPLAY = "'Exo 2', system-ui, sans-serif";   // шапка, баланс, лейблы, кнопки
const FONT_BODY = "'Space Grotesk', system-ui, sans-serif"; // тело, названия категорий
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace"; // суммы, даты, коды

const ACCENT = '#E08A3C';                         // янтарь (плоский)
const ACCENT_GRAD = 'linear-gradient(135deg,#EDA053,#C8643C)';
const POSITIVE = '#C6F135';                        // кислотный лайм — доход
const ON_ACCENT = '#1A120A';                       // тёмный текст на акценте

const THEME = {
  BG: '#080808', BG_RAISED: '#111111', BG_HERO: '#101010', BG_INPUT: '#161616',
  BORDER: '#2A2A2A', HAIR: '#1E1E1E',
  ACCENT, ACCENT_GRAD, ACCENT_SOFT: '#EDA053', POSITIVE, ON_ACCENT, GOLD: '#EDA053',
  TEXT: '#F2F2F2', TEXT_DIM: '#B8B0A4', TEXT_FAINT: '#565656', TEXT_META: '#8A8A8A',
};
// Обе схемы Telegram → одна тёмная тема (решение редизайна: dark-only)
const THEMES = { dark: THEME, light: THEME };

// Пончик расходов: янтарь → медь → серые, лайм-акцент
const SERIES = ['#E08A3C', '#C8643C', '#8A8A8A', '#C6F135', '#4E4E4E', '#EDA053', '#B8B0A4', '#6E6E6E'];

// Скошенные грани (сигнатура)
const CUT = (n) => `polygon(0 0,calc(100% - ${n}px) 0,100% ${n}px,100% 100%,${n}px 100%,0 calc(100% - ${n}px))`;
const CUT_BR = (v, h) => `polygon(0 0,100% 0,100% calc(100% - ${v}px),calc(100% - ${h}px) 100%,0 100%)`;
const CUT_TL = (n) => `polygon(${n}px 0,100% 0,100% 100%,0 100%)`;
const HATCH = (color, gap) => `repeating-linear-gradient(-60deg,${color} 0 1px,transparent 1px ${gap}px)`;

const ThemeContext = createContext(THEME);
const useTheme = () => useContext(ThemeContext);

/* ============================================================
   Валюты
   ============================================================ */
const CURRENCIES = [
  { code: 'RUB', label: '₽ Рубль' },
  { code: 'USD', label: '$ Доллар' },
  { code: 'EUR', label: '€ Евро' },
  { code: 'GEL', label: '₾ Лари' },
  { code: 'KZT', label: '₸ Тенге' },
  { code: 'TRY', label: '₺ Лира' },
];
const DEFAULT_CATEGORIES = {
  expense: [
    'Супермаркеты', 'Фастфуд', 'Рестораны', 'Заправки', 'Автоуслуги', 'Такси',
    'Местный транспорт', 'Транспорт', 'Авиабилеты', 'Турагенства', 'Отели',
    'Развлечения', 'Кино', 'Онлайн-кинотеатр', 'Цифровые товары', 'Маркетплейсы',
    'Различные товары', 'Одежда и обувь', 'Гаджеты и техника', 'Ремонт и мебель',
    'Спорттовары', 'Цветы', 'Медицина', 'Аптеки', 'Красота', 'Сервис',
    'Мобильная связь', 'Услуги банка', 'Госуслуги', 'Экосистема Яндекс',
    'Животные', 'Переводы', 'Другое',
  ],
  income: ['Зарплата', 'Кэшбэк', 'Бонусы', 'Проценты'],
};
// Подкатегории — опциональны, заводятся пользователем внутри категории
const DEFAULT_SUBCATEGORIES = { expense: {}, income: {} };

/* ============================================================
   Хелперы
   ============================================================ */
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (iso) => iso.slice(0, 7); // YYYY-MM
const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const fmtMonth = (mk) => { const [y, m] = mk.split('-'); return `${MONTHS_RU[+m - 1]} ${y}`; };
const fmtMonthShort = (mk) => { const [y, m] = mk.split('-'); return `${MONTHS_RU[+m - 1].toUpperCase()} ${y}`; };
const shiftMonth = (mk, delta) => {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
function money(amount, currency) {
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}
function num(amount, currency) {
  // Число без символа валюты — для крупных дисплейных сумм
  try {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount}`;
  }
}
const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).toUpperCase(); }
  catch { return iso; }
};
// Неделя с понедельника
const addDaysISO = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (iso) => { const d = new Date(iso + 'T00:00:00'); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return d.toISOString().slice(0, 10); };
const fmtDM = (iso) => { try { return new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); } catch { return iso; } };
const fmtWeekRange = (mondayIso) => `${fmtDM(mondayIso)} – ${fmtDM(addDaysISO(mondayIso, 6))}`;
const fmtDayFull = (iso) => { try { return new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return iso; } };

/* ============================================================
   Курсы валют — ЦБ РФ. Рубль базовый; для остальных валют
   показываем эквивалент в рублях. Источник: cbr-xml-daily.ru
   (официальные данные Банка России, CORS-совместимый зеркало).
   ============================================================ */
let _ratesCache = null; // { rates: {CODE: рублей за 1 единицу}, date: 'DD.MM' }
async function fetchRates() {
  if (_ratesCache) return _ratesCache;
  const res = await fetch('https://www.cbr-xml-daily.ru/daily_json.js');
  if (!res.ok) throw new Error('rates-http');
  const json = await res.json();
  const rates = { RUB: 1 };
  const changes = {}; // код → изменение курса к рублю за сутки, %
  for (const [code, v] of Object.entries(json.Valute || {})) {
    if (v && v.Value && v.Nominal) {
      const cur = v.Value / v.Nominal;
      rates[code] = cur; // рублей за 1 ед.
      if (v.Previous) { const prev = v.Previous / v.Nominal; if (prev) changes[code] = ((cur - prev) / prev) * 100; }
    }
  }
  let date = '';
  try { date = new Date(json.Date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }); } catch { /* noop */ }
  _ratesCache = { rates, date, changes };
  return _ratesCache;
}
function useRates() {
  const [state, setState] = useState({ rates: null, date: '', changes: {} });
  useEffect(() => {
    let alive = true;
    fetchRates().then((r) => { if (alive) setState(r); }).catch(() => { /* курсы недоступны — конвертер скрыт */ });
    return () => { alive = false; };
  }, []);
  return state;
}
// Пересчёт суммы из одной валюты в другую по курсам ЦБ (через рубль)
function convert(amount, from, to, rates) {
  if (!rates || !rates[from] || !rates[to]) return null;
  return (amount * rates[from]) / rates[to];
}
const fmtRub = (v) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: v >= 1000 ? 0 : 2 }).format(v);

/* ============================================================
   Примитивы UI
   ============================================================ */
function Field({ label, children }) {
  const t = useTheme();
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontFamily: FONT_DISPLAY, fontSize: 10, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: t.TEXT_FAINT, marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}
function inputStyle(t) {
  return {
    width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 16, fontFamily: FONT_BODY,
    background: t.BG_INPUT, color: t.TEXT, border: `1px solid ${t.BORDER}`,
    borderRadius: 0, clipPath: CUT(8), outline: 'none',
  };
}
function Btn({ children, onClick, variant = 'primary', style, disabled, type = 'button' }) {
  const t = useTheme();
  const base = {
    border: 'none', borderRadius: 0, padding: '13px 16px', fontSize: 13, fontWeight: 800,
    fontFamily: FONT_DISPLAY, letterSpacing: '.08em', textTransform: 'uppercase',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  };
  const variants = {
    primary: { background: t.ACCENT_GRAD, color: t.ON_ACCENT, clipPath: CUT_BR(11, 18), boxShadow: '0 12px 26px -12px rgba(224,138,60,.85)' },
    ghost: { background: t.BG_INPUT, color: t.TEXT, clipPath: CUT(9) },
    danger: { background: 'transparent', color: t.ACCENT, border: `1px solid ${t.BORDER}`, clipPath: CUT(9) },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

/* ============================================================
   Экран входа / статусов
   ============================================================ */
function CenterScreen({ children }) {
  const t = useTheme();
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: 24, textAlign: 'center', color: t.TEXT, gap: 14,
    }}>
      {children}
    </div>
  );
}

/* ============================================================
   Форма добавления/редактирования транзакции
   ============================================================ */
function TxForm({ initial, categories, subcategories, onCancel, onSubmit }) {
  const t = useTheme();
  const isEdit = !!initial;
  const { rates, date: ratesDate } = useRates();
  const [date, setDate] = useState(initial?.occurred_at || todayISO());
  const [busy, setBusy] = useState(false);

  // Форма поддерживает несколько позиций (микс доход/расход) → отдельные операции
  const emptyLine = () => ({ id: Math.random().toString(36).slice(2), kind: 'expense', amount: '', currency: 'RUB', category: '', subcategory: '', note: '' });
  const [lines, setLines] = useState(() => initial
    ? [{ id: 'edit', kind: initial.kind || 'expense', amount: initial.amount != null ? String(initial.amount) : '', currency: initial.currency || 'RUB', category: initial.category || '', subcategory: initial.subcategory || '', note: initial.note || '' }]
    : [emptyLine()]);

  const patchLine = (id, patch) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);

  async function submit(e) {
    e.preventDefault();
    const prepared = [];
    for (const l of lines) {
      const n = parseFloat((l.amount || '').replace(',', '.'));
      if (!n || isNaN(n)) return alert('Введи сумму во всех позициях');
      if (Math.abs(n) < 0.01) return alert('Сумма не может быть меньше 0,01');
      if (!l.category.trim()) return alert('Выбери категорию во всех позициях');
      // В БД сумма всегда положительная — знак выражается через kind
      prepared.push({ kind: l.kind, amount: Math.abs(n), currency: l.currency, category: l.category.trim(), subcategory: (l.subcategory || '').trim(), occurred_at: date, note: (l.note || '').trim() });
    }
    setBusy(true);
    try { await onSubmit(prepared); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} style={{ background: t.BG_RAISED, clipPath: CUT(14), padding: 16, marginBottom: 16 }}>
      {lines.map((l, i) => (
        <LineEditor key={l.id} line={l} index={i} total={lines.length}
          categories={categories} subcategories={subcategories} rates={rates} ratesDate={ratesDate}
          onPatch={(p) => patchLine(l.id, p)} onRemove={() => removeLine(l.id)}
          canRemove={!isEdit && lines.length > 1} autoFocus={i === 0} />
      ))}

      {!isEdit && (
        <Btn variant="ghost" onClick={addLine} style={{ width: '100%', marginBottom: 12 }}>
          <Plus size={16} /> Ещё позиция
        </Btn>
      )}

      <Field label="Дата">
        <input
          type="date"
          value={date}
          max={todayISO()}
          onChange={(e) => { if (e.target.value && e.target.value <= todayISO()) setDate(e.target.value); }}
          style={{
            ...inputStyle(t), fontFamily: FONT_MONO, fontSize: 15,
            textAlign: 'left', WebkitAppearance: 'none', appearance: 'none',
            minHeight: 44, lineHeight: '22px', display: 'block',
          }}
        />
      </Field>

      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <Btn variant="ghost" onClick={onCancel} style={{ flex: 1 }}>Отмена</Btn>
        <Btn type="submit" disabled={busy} style={{ flex: 2 }}>
          {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} {isEdit ? 'Сохранить' : (lines.length > 1 ? `Сохранить · ${lines.length}` : 'Сохранить')}
        </Btn>
      </div>
    </form>
  );
}

/* ============================================================
   Combobox — поле с вводом и фильтруемым выпадающим списком.
   Свободный ввод разрешён; новое значение сохраняется при отправке.
   ============================================================ */
function Combobox({ value, onChange, options, placeholder, autoFocus }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const q = value || '';
  const ql = q.trim().toLowerCase();
  const filtered = options.filter((o) => o.toLowerCase().includes(ql));
  const isNew = ql.length > 0 && !options.some((o) => o.toLowerCase() === ql);
  const opt = { display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'left', border: 'none', background: 'transparent', color: t.TEXT, fontFamily: FONT_BODY, fontSize: 14, padding: '10px 11px', cursor: 'pointer' };
  return (
    <div style={{ position: 'relative' }}>
      <input
        value={q} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        style={inputStyle(t)}
      />
      {open && (filtered.length > 0 || isNew) && (
        <div style={{ position: 'absolute', zIndex: 40, left: 0, right: 0, top: 'calc(100% + 4px)', background: t.BG_INPUT, border: `1px solid ${t.BORDER}`, boxShadow: '0 16px 34px -12px rgba(0,0,0,.85)', maxHeight: 176, overflowY: 'auto' }}>
          {isNew && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(q.trim()); setOpen(false); }}
              style={{ ...opt, color: t.GOLD, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12, letterSpacing: '.04em' }}>
              + Добавить «{q.trim()}»
            </button>
          )}
          {filtered.map((o) => (
            <button key={o} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(o); setOpen(false); }}
              style={{ ...opt, borderTop: `1px solid ${t.HAIR}` }}>{o}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Одна позиция в форме (тип, сумма, валюта, категория, подкатегория, заметка)
   ============================================================ */
function LineEditor({ line, index, total, categories, subcategories, rates, ratesDate, onPatch, onRemove, canRemove, autoFocus }) {
  const t = useTheme();
  const catList = categories[line.kind] || [];
  const subList = (subcategories?.[line.kind]?.[line.category]) || [];

  const amountNum = Math.abs(parseFloat((line.amount || '').replace(',', '.')));
  const rate = rates && line.currency !== 'RUB' ? rates[line.currency] : null;
  const rubEquiv = rate && amountNum ? amountNum * rate : null;

  function sanitizeAmount(v) {
    const neg = /^-/.test(v.trim());
    let s = v.replace(/[^\d.,]/g, '').replace(/\./g, ',');
    const p = s.split(',');
    s = p[0] + (p.length > 1 ? ',' + p.slice(1).join('').slice(0, 2) : '');
    return (neg ? '-' : '') + s;
  }
  function onAmount(v) {
    const clean = sanitizeAmount(v);
    const patch = { amount: clean };
    if (clean.startsWith('-') && line.kind !== 'expense') { patch.kind = 'expense'; patch.category = ''; patch.subcategory = ''; }
    onPatch(patch);
  }

  const multi = total > 1;
  return (
    <div style={{ background: multi ? t.BG_HERO : 'transparent', clipPath: multi ? CUT(10) : 'none', padding: multi ? '12px 12px 2px' : 0, marginBottom: multi ? 10 : 0 }}>
      {multi && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 9, letterSpacing: '.16em', color: t.TEXT_FAINT }}>ПОЗИЦИЯ {String(index + 1).padStart(2, '0')}</span>
          <span style={{ flex: 1 }} />
          {canRemove && <button type="button" onClick={onRemove} style={iconBtn(t)}><X size={15} /></button>}
        </div>
      )}

      {/* Тип */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[['expense', 'Расход', TrendingDown], ['income', 'Доход', TrendingUp]].map(([k, lbl, Icon]) => {
          const on = line.kind === k;
          return (
            <button key={k} type="button" onClick={() => onPatch({ kind: k, category: '', subcategory: '' })} style={{
              flex: 1, padding: '10px', border: 'none', clipPath: CUT(8), cursor: 'pointer',
              fontWeight: 800, fontFamily: FONT_DISPLAY, letterSpacing: '.06em', textTransform: 'uppercase', fontSize: 11.5,
              background: on ? (k === 'income' ? t.POSITIVE : t.ACCENT_GRAD) : t.BG_INPUT,
              color: on ? t.ON_ACCENT : t.TEXT_DIM,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Icon size={15} /> {lbl}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 2 }}>
          <Field label="Сумма">
            <input inputMode="decimal" value={line.amount} onChange={(e) => onAmount(e.target.value)}
              placeholder="0" autoFocus={autoFocus} style={{ ...inputStyle(t), fontFamily: FONT_MONO, fontWeight: 600 }} />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Валюта">
            <select value={line.currency} onChange={(e) => onPatch({ currency: e.target.value })} style={{ ...inputStyle(t), fontFamily: FONT_MONO }}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {/* Конвертер: рубль базовый — эквивалент в ₽ по курсу ЦБ */}
      {rate && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: t.BG_INPUT, clipPath: CUT(8), padding: '8px 11px', marginBottom: 12, borderLeft: `2px solid ${t.ACCENT}` }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: t.TEXT_META }}>1 {line.currency} = {fmtRub(rate)} ₽{ratesDate ? ` · ЦБ ${ratesDate}` : ''}</span>
          {rubEquiv != null && <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12, color: t.TEXT, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>≈ {fmtRub(rubEquiv)} ₽</span>}
        </div>
      )}

      <Field label="Категория">
        <Combobox value={line.category} onChange={(v) => onPatch({ category: v, subcategory: '' })} options={catList} placeholder="Начни вводить или выбери" />
      </Field>

      {line.category.trim() && (
        <Field label="Подкатегория · необязательно">
          <Combobox value={line.subcategory} onChange={(v) => onPatch({ subcategory: v })} options={subList} placeholder="Начни вводить или выбери" />
        </Field>
      )}

      <Field label="Заметка (необязательно)">
        <input value={line.note} onChange={(e) => onPatch({ note: e.target.value })} placeholder="Комментарий" style={inputStyle(t)} />
      </Field>
    </div>
  );
}

/* ============================================================
   Секция-лейбл с HUD-разметкой
   ============================================================ */
function HudLabel({ children, right }) {
  const t = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 9.5, letterSpacing: '.22em', textTransform: 'uppercase', color: t.TEXT_FAINT }}>{children}</span>
      <div style={{ flex: 1, height: 7, backgroundImage: HATCH(t.BORDER, 7) }} />
      {right != null && <span style={{ fontFamily: FONT_MONO, fontWeight: 600, fontSize: 9.5, color: t.TEXT_FAINT }}>{right}</span>}
    </div>
  );
}

/* ============================================================
   Бегущая строка курсов ЦБ + суточное изменение
   ============================================================ */
function RatesTicker() {
  const t = useTheme();
  const { rates, changes } = useRates();
  if (!rates) return null;
  const items = CURRENCIES.filter((c) => c.code !== 'RUB' && rates[c.code])
    .map((c) => ({ code: c.code, rate: rates[c.code], ch: changes?.[c.code] }));
  if (!items.length) return null;

  const Item = ({ it }) => {
    const up = it.ch != null && it.ch >= 0;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 26, fontFamily: FONT_MONO, fontSize: 11, whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: 700, color: t.TEXT, letterSpacing: '.04em' }}>{it.code}</span>
        <span style={{ color: t.TEXT_DIM }}>{fmtRub(it.rate)} ₽</span>
        {it.ch != null && (
          <span style={{ fontWeight: 700, color: up ? t.POSITIVE : t.ACCENT }}>
            {up ? '▲' : '▼'} {Math.abs(it.ch).toFixed(2)}%
          </span>
        )}
      </span>
    );
  };
  const row = (dupKey) => items.map((it) => <Item key={dupKey + it.code} it={it} />);

  return (
    <div style={{ position: 'relative', overflow: 'hidden', background: t.BG_RAISED, clipPath: CUT(9), padding: '8px 0', marginBottom: 16 }}>
      <div className="ticker-track">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 26, marginLeft: 12, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 9, letterSpacing: '.16em', textTransform: 'uppercase', color: t.TEXT_FAINT }}>Курсы ЦБ · 24ч</span>
        {row('a')}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 26, marginLeft: 12, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 9, letterSpacing: '.16em', textTransform: 'uppercase', color: t.TEXT_FAINT }}>Курсы ЦБ · 24ч</span>
        {row('b')}
      </div>
    </div>
  );
}

/* ============================================================
   Строка операции
   ============================================================ */
function TxRow({ x, onEdit, onDelete }) {
  const t = useTheme();
  const inc = x.kind === 'income';
  return (
    <div style={{
      background: t.BG_RAISED, clipPath: CUT_TL(14), padding: '10px 12px 10px 6px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ width: 5, alignSelf: 'stretch', marginLeft: 8, transform: 'skewX(-18deg)', background: inc ? t.POSITIVE : t.ACCENT }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: t.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {x.category}{x.subcategory ? <span style={{ color: t.TEXT_FAINT, fontWeight: 500 }}> · {x.subcategory}</span> : null}
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '.06em', color: t.TEXT_FAINT, marginTop: 2 }}>
          {fmtDate(x.occurred_at)}{x.note ? ` · ${x.note.toUpperCase()}` : ''}
        </div>
      </div>
      <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums', color: inc ? t.POSITIVE : t.TEXT }}>
        {inc ? '+' : '−'}{num(x.amount, x.currency)}
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        <button onClick={() => onEdit(x)} style={iconBtn(t)}><Pencil size={14} /></button>
        <button onClick={() => { if (confirm('Удалить операцию?')) onDelete(x.id); }} style={iconBtn(t)}><Trash2 size={14} /></button>
      </div>
    </div>
  );
}

/* ============================================================
   Иерархический журнал: Месяц → Неделя → День
   Текущий месяц развёрнут по неделям (текущая неделя раскрыта),
   прошлые месяцы — сворачиваемые группы.
   ============================================================ */
const sumByCur = (list) => {
  const m = {};
  for (const x of list) { (m[x.currency] ||= { income: 0, expense: 0 })[x.kind] += x.amount; }
  return Object.entries(m);
};
function GroupSums({ list }) {
  const t = useTheme();
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
      {sumByCur(list).map(([cur, v]) => (
        <span key={cur} style={{ fontFamily: FONT_MONO, fontSize: 10, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {v.income ? <span style={{ color: t.POSITIVE, fontWeight: 700 }}>+{num(v.income, cur)}</span> : null}
          {v.expense ? <span style={{ color: t.ACCENT, fontWeight: 700 }}>{v.income ? ' ' : ''}−{num(v.expense, cur)}</span> : null}
          <span style={{ color: t.TEXT_FAINT }}> {cur}</span>
        </span>
      ))}
    </span>
  );
}
function buildTree(list) {
  const months = new Map();
  for (const x of list) {
    const mk = monthKey(x.occurred_at), wk = mondayOf(x.occurred_at), dk = x.occurred_at;
    let M = months.get(mk); if (!M) { M = { txs: [], weeks: new Map() }; months.set(mk, M); } M.txs.push(x);
    let W = M.weeks.get(wk); if (!W) { W = { txs: [], days: new Map() }; M.weeks.set(wk, W); } W.txs.push(x);
    let D = W.days.get(dk); if (!D) { D = { txs: [] }; W.days.set(dk, D); } D.txs.push(x);
  }
  return months;
}
function Journal({ txs, month, onEdit, onDelete }) {
  const t = useTheme();
  const today = todayISO();
  const curMonth = monthKey(today);
  const curWeek = mondayOf(today);
  const [openMonths, setOpenMonths] = useState(() => new Set());
  const [openWeeks, setOpenWeeks] = useState(() => new Set([curWeek]));
  const [closedDays, setClosedDays] = useState(() => new Set());

  // Навигатор месяца раскрывает соответствующую группу в журнале
  useEffect(() => {
    if (month && month !== curMonth) setOpenMonths((s) => (s.has(month) ? s : new Set(s).add(month)));
  }, [month, curMonth]);

  const toggle = (setter) => (key) => setter((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleMonth = toggle(setOpenMonths);
  const toggleWeek = toggle(setOpenWeeks);
  const toggleDay = toggle(setClosedDays);

  const sorted = useMemo(() => [...txs].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1)), [txs]);
  const months = useMemo(() => buildTree(sorted), [sorted]);

  if (sorted.length === 0) return null;

  const chev = (open) => <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: t.TEXT_META, width: 12, display: 'inline-block' }}>{open ? '▾' : '▸'}</span>;

  const renderWeeks = (M) => [...M.weeks.entries()].map(([wk, W]) => {
    const weekOpen = openWeeks.has(wk);
    const isCurWeek = wk === curWeek;
    return (
      <div key={wk} style={{ marginBottom: 6 }}>
        <button onClick={() => toggleWeek(wk)} style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: t.BG_HERO, clipPath: CUT(8),
          border: 'none', cursor: 'pointer', padding: '8px 11px', textAlign: 'left',
          borderLeft: isCurWeek ? `2px solid ${t.ACCENT}` : `2px solid ${t.HAIR}`,
        }}>
          {chev(weekOpen)}
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: t.TEXT_DIM, whiteSpace: 'nowrap' }}>{fmtWeekRange(wk)}</span>
          {isCurWeek && <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 8, letterSpacing: '.14em', textTransform: 'uppercase', color: t.ACCENT }}>Тек.</span>}
          <span style={{ flex: 1 }} />
          <GroupSums list={W.txs} />
        </button>
        {weekOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 5, paddingLeft: 8 }}>
            {[...W.days.entries()].map(([dk, D]) => {
              const dayOpen = !closedDays.has(dk);
              return (
                <div key={dk}>
                  <button onClick={() => toggleDay(dk)} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'transparent',
                    border: 'none', cursor: 'pointer', padding: '3px 2px', textAlign: 'left',
                  }}>
                    {chev(dayOpen)}
                    <span style={{ fontFamily: FONT_MONO, fontSize: 9.5, letterSpacing: '.04em', textTransform: 'uppercase', color: t.TEXT_FAINT }}>{fmtDayFull(dk)}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: t.TEXT_FAINT }}>{String(D.txs.length).padStart(2, '0')}</span>
                  </button>
                  {dayOpen && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                      {D.txs.map((x) => <TxRow key={x.id} x={x} onEdit={onEdit} onDelete={onDelete} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[...months.entries()].map(([mk, M]) => {
        const isCur = mk === curMonth;
        const monthOpen = isCur || openMonths.has(mk);
        return (
          <div key={mk}>
            {!isCur && (
              <button onClick={() => toggleMonth(mk)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 9, background: t.BG_RAISED, clipPath: CUT(9),
                border: 'none', cursor: 'pointer', padding: '11px 12px', textAlign: 'left', marginBottom: monthOpen ? 8 : 0,
              }}>
                {chev(monthOpen)}
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: t.TEXT }}>{fmtMonthShort(mk)}</span>
                <span style={{ flex: 1 }} />
                <GroupSums list={M.txs} />
              </button>
            )}
            {monthOpen && <div style={{ paddingLeft: isCur ? 0 : 6 }}>{renderWeeks(M)}</div>}
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   Вкладка «Операции»
   ============================================================ */
function OperationsTab({ txs, month, setMonth, categories, subcategories, onCreateMany, onUpdateOne, onDelete }) {
  const t = useTheme();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const atCurrentMonth = month >= monthKey(todayISO()); // нельзя листать дальше текущего месяца

  const monthTxs = txs.filter((x) => monthKey(x.occurred_at) === month)
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));

  // Итоги за месяц по валютам
  const totals = useMemo(() => {
    const acc = {};
    for (const x of monthTxs) {
      acc[x.currency] ||= { income: 0, expense: 0 };
      acc[x.currency][x.kind] += x.amount;
    }
    return acc;
  }, [monthTxs]);

  const curEntries = Object.entries(totals);
  const [primaryCur, ...restCur] = curEntries;

  return (
    <div>
      {/* Hero-баланс основной валюты */}
      {primaryCur ? (
        <HeroBalance cur={primaryCur[0]} v={primaryCur[1]} month={month} />
      ) : (
        <div style={{ position: 'relative', background: t.BG_HERO, clipPath: CUT_BR(22, 40), padding: '22px 18px', marginBottom: 13, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, backgroundImage: HATCH('rgba(224,138,60,.05)', 11), pointerEvents: 'none' }} />
          <div style={{ position: 'relative', fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 9, letterSpacing: '.26em', textTransform: 'uppercase', color: t.TEXT_META, marginBottom: 8 }}>БАЛАНС · {fmtMonthShort(month)}</div>
          <div style={{ position: 'relative', color: t.TEXT_FAINT, fontFamily: FONT_BODY, fontSize: 14 }}>Нет операций за этот месяц</div>
        </div>
      )}

      {/* Месяц + дополнительные валюты */}
      <div style={{ display: 'flex', gap: 7, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 150, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: t.BG_RAISED, clipPath: CUT(9), padding: '8px 12px' }}>
          <button onClick={() => setMonth(shiftMonth(month, -1))} style={{ ...iconBtn(t), fontFamily: FONT_MONO, fontWeight: 700, fontSize: 16, color: t.TEXT_META }}>‹</button>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 11, letterSpacing: '.16em', color: t.TEXT }}>{fmtMonthShort(month)}</span>
          <button disabled={atCurrentMonth} onClick={() => { if (!atCurrentMonth) setMonth(shiftMonth(month, 1)); }} style={{ ...iconBtn(t), fontFamily: FONT_MONO, fontWeight: 700, fontSize: 16, color: t.TEXT_META, opacity: atCurrentMonth ? 0.25 : 1, cursor: atCurrentMonth ? 'default' : 'pointer' }}>›</button>
        </div>
        {restCur.map(([cur, v]) => (
          <div key={cur} style={{ display: 'flex', alignItems: 'center', gap: 7, background: t.BG_RAISED, clipPath: CUT(9), padding: '8px 12px' }}>
            <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 11, color: t.TEXT }}>{cur}</span>
            <span style={{ fontFamily: FONT_MONO, fontWeight: 600, fontSize: 10, color: t.POSITIVE }}>+{num(v.income, cur)}</span>
            <span style={{ fontFamily: FONT_MONO, fontWeight: 600, fontSize: 10, color: t.ACCENT }}>−{num(v.expense, cur)}</span>
          </div>
        ))}
      </div>

      {!adding && !editing && (
        <Btn onClick={() => setAdding(true)} style={{ width: '100%', marginBottom: 16 }}>
          <Plus size={18} /> Новая операция
        </Btn>
      )}

      {adding && (
        <TxForm categories={categories} subcategories={subcategories} onCancel={() => setAdding(false)}
          onSubmit={async (list) => { await onCreateMany(list); setAdding(false); }} />
      )}
      {editing && (
        <TxForm initial={editing} categories={categories} subcategories={subcategories} onCancel={() => setEditing(null)}
          onSubmit={async (list) => { await onUpdateOne(editing.id, list[0]); setEditing(null); }} />
      )}

      {/* Бегущая строка курсов ЦБ (между «Новой операцией» и «Журналом») */}
      <RatesTicker />

      {/* Журнал — все операции, сгруппированы по месяцам/неделям/дням */}
      {txs.length > 0 && <HudLabel right={String(txs.length).padStart(2, '0')}>Журнал</HudLabel>}
      <Journal txs={txs} month={month} onEdit={(x) => { setAdding(false); setEditing(x); }} onDelete={onDelete} />
    </div>
  );
}

function HeroBalance({ cur, v, month }) {
  const t = useTheme();
  const bal = v.income - v.expense;
  return (
    <div style={{ position: 'relative', background: t.BG_HERO, clipPath: CUT_BR(22, 40), padding: '16px 18px 20px', marginBottom: 13, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: HATCH('rgba(224,138,60,.06)', 11), pointerEvents: 'none' }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 9, letterSpacing: '.26em', textTransform: 'uppercase', color: t.TEXT_META }}>Баланс · {fmtMonthShort(month)}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: FONT_MONO, fontWeight: 700, fontSize: 8, letterSpacing: '.1em', textTransform: 'uppercase', color: t.POSITIVE }}>
          <ShieldCheck size={11} color={t.POSITIVE} /> Шифр
        </span>
      </div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', gap: 7 }}>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 34, lineHeight: 1, letterSpacing: '-.01em', color: t.TEXT, fontVariantNumeric: 'tabular-nums' }}>
          {bal >= 0 ? '+' : '−'}{num(Math.abs(bal), cur)}
        </span>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 15, color: t.ACCENT }}>{cur}</span>
      </div>
      <div style={{ position: 'relative', display: 'flex', gap: 18, marginTop: 11 }}>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 600, fontSize: 11, color: t.POSITIVE, fontVariantNumeric: 'tabular-nums' }}>▲ +{num(v.income, cur)}</span>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 600, fontSize: 11, color: t.ACCENT, fontVariantNumeric: 'tabular-nums' }}>▼ −{num(v.expense, cur)}</span>
      </div>
    </div>
  );
}

function iconBtn(t) {
  return { background: 'transparent', border: 'none', color: t.TEXT_META, cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' };
}

/* ============================================================
   Вкладка «Статистика»
   ============================================================ */
// Активный сектор пончика: крупнее и выдвинут из круга. pop (0..1) — фаза анимации.
function renderActiveSlice(props, pop = 1) {
  const RAD = Math.PI / 180;
  const { cx, cy, midAngle, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  const dx = Math.cos(-RAD * midAngle) * 10 * pop;
  const dy = Math.sin(-RAD * midAngle) * 10 * pop;
  const grow = 10 * pop;
  return (
    <g>
      <Sector cx={cx + dx} cy={cy + dy} innerRadius={innerRadius} outerRadius={outerRadius + grow}
        startAngle={startAngle} endAngle={endAngle} fill={fill} stroke="none" />
      {pop > 0.35 && (
        <Sector cx={cx + dx} cy={cy + dy} innerRadius={outerRadius + grow + 3} outerRadius={outerRadius + grow + 5}
          startAngle={startAngle} endAngle={endAngle} fill={fill} stroke="none" opacity={0.5 * pop} />
      )}
    </g>
  );
}

function StatsTab({ txs, month, setMonth }) {
  const t = useTheme();
  const [cur, setCur] = useState(null);
  const [activeIdx, setActiveIdx] = useState(null);
  const [pop, setPop] = useState(0);
  const popRef = useRef(0);
  const { rates } = useRates();

  // Плавный выезд активного сектора (easeOutCubic)
  useEffect(() => {
    const to = activeIdx != null ? 1 : 0;
    const from = activeIdx != null ? 0 : popRef.current;
    const dur = 280; const start = performance.now();
    let raf;
    const ease = (k) => 1 - Math.pow(1 - k, 3);
    const tick = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const v = from + (to - from) * ease(k);
      popRef.current = v; setPop(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeIdx]);

  const monthTxs = txs.filter((x) => monthKey(x.occurred_at) === month);
  const currencies = [...new Set(monthTxs.map((x) => x.currency))];
  const activeCur = cur && currencies.includes(cur) ? cur : currencies[0];

  const curTxs = monthTxs.filter((x) => x.currency === activeCur);
  const income = curTxs.filter((x) => x.kind === 'income').reduce((s, x) => s + x.amount, 0);
  const expense = curTxs.filter((x) => x.kind === 'expense').reduce((s, x) => s + x.amount, 0);

  const byCategory = useMemo(() => {
    const acc = {};
    for (const x of curTxs.filter((x) => x.kind === 'expense')) acc[x.category] = (acc[x.category] || 0) + x.amount;
    return Object.entries(acc).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [curTxs]);

  // Сброс выделенного сектора при смене валюты/месяца
  useEffect(() => { setActiveIdx(null); }, [activeCur, month]);

  // Hero-заголовок
  const Hero = (
    <div style={{ position: 'relative', background: t.BG_HERO, clipPath: CUT_BR(22, 40), padding: '16px 18px 18px', marginBottom: 13, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: HATCH('rgba(198,241,53,.05)', 11), pointerEvents: 'none' }} />
      <div style={{ position: 'relative', fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 9, letterSpacing: '.26em', textTransform: 'uppercase', color: t.TEXT_META, marginBottom: 6 }}>Статистика · STAT·02</div>
      <div style={{ position: 'relative', fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 26, lineHeight: 1, letterSpacing: '-.01em', color: t.TEXT }}>{fmtMonthShort(month)}</div>
    </div>
  );

  if (currencies.length === 0) {
    return (
      <div>
        {Hero}
        <MonthNav month={month} setMonth={setMonth} />
        <div style={{ color: t.TEXT_FAINT, fontFamily: FONT_BODY, textAlign: 'center', padding: 40 }}>Нет данных за месяц</div>
      </div>
    );
  }

  return (
    <div>
      {Hero}
      <MonthNav month={month} setMonth={setMonth} />

      {currencies.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {currencies.map((c) => {
            const on = c === activeCur;
            return (
              <button key={c} onClick={() => setCur(c)} style={{
                padding: '7px 17px', border: 'none', clipPath: CUT(8), cursor: 'pointer',
                fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 10, letterSpacing: '.12em',
                background: on ? t.ACCENT_GRAD : t.BG_RAISED,
                color: on ? t.ON_ACCENT : t.TEXT_META,
              }}>{c}</button>
            );
          })}
        </div>
      )}

      {/* Карточки. Под рублёвыми суммами — эквивалент в долларах по курсу ЦБ */}
      {(() => {
        const showUsd = activeCur === 'RUB' && rates && rates.USD;
        const usd = (rub) => { const v = convert(Math.abs(rub), 'RUB', 'USD', rates); return v != null ? `≈ $${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v)}` : null; };
        const bal = income - expense;
        return (
          <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
            <StatCard label="Доход" value={num(income, activeCur)} color={t.POSITIVE} sub={showUsd ? usd(income) : null} />
            <StatCard label="Расход" value={num(expense, activeCur)} color={t.ACCENT} sub={showUsd ? usd(expense) : null} />
            <StatCard label="Баланс" value={`${bal >= 0 ? '+' : '−'}${num(Math.abs(bal), activeCur)}`} color={t.TEXT} sub={showUsd ? usd(bal) : null} />
          </div>
        );
      })()}

      {/* Накопительный баланс — сумма всех операций вплоть до выбранного месяца */}
      {(() => {
        const cum = txs.filter((x) => x.currency === activeCur && monthKey(x.occurred_at) <= month)
          .reduce((s, x) => s + (x.kind === 'income' ? x.amount : -x.amount), 0);
        const pos = cum >= 0;
        const usdV = activeCur === 'RUB' && rates && rates.USD ? convert(Math.abs(cum), 'RUB', 'USD', rates) : null;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: t.BG_RAISED, clipPath: CUT(9), padding: '11px 14px', marginBottom: 14, borderLeft: `3px solid ${pos ? t.POSITIVE : t.ACCENT}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 8.5, letterSpacing: '.16em', textTransform: 'uppercase', color: t.TEXT_FAINT }}>Накопительный баланс</div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '.06em', color: t.TEXT_FAINT, marginTop: 3 }}>С НАЧАЛА ДО {fmtMonthShort(month)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 700, color: pos ? t.POSITIVE : t.ACCENT, fontVariantNumeric: 'tabular-nums' }}>
                {pos ? '+' : '−'}{num(Math.abs(cum), activeCur)} <span style={{ fontSize: 11, color: t.TEXT_META }}>{activeCur}</span>
              </div>
              {usdV != null && <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: t.TEXT_FAINT, marginTop: 2 }}>≈ ${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(usdV)}</div>}
            </div>
          </div>
        );
      })()}

      {/* Пончик расходов */}
      {byCategory.length > 0 && (
        <div style={{ position: 'relative', background: t.BG_HERO, clipPath: CUT_BR(20, 36), padding: '15px 16px 18px', marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, backgroundImage: HATCH('rgba(255,255,255,.03)', 12), pointerEvents: 'none' }} />
          <div style={{ position: 'relative' }}><HudLabel>Расходы · категории</HudLabel></div>
          <div style={{ position: 'relative', width: '100%', maxWidth: 320, margin: '0 auto' }}>
            <ResponsiveContainer width="100%" height={224}>
              <PieChart>
                <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={52} outerRadius={84} paddingAngle={2} stroke="none"
                  isAnimationActive={false}
                  activeIndex={activeIdx ?? undefined} activeShape={(p) => renderActiveSlice(p, pop)}
                  onClick={(_, idx) => setActiveIdx((c) => (c === idx ? null : idx))}>
                  {byCategory.map((e, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} cursor="pointer" />)}
                </Pie>
                <Tooltip formatter={(v) => money(v, activeCur)}
                  cursor={{ fill: 'rgba(224,138,60,.08)' }}
                  contentStyle={{ background: '#0C0C0C', border: `1.5px solid ${t.ACCENT}`, borderRadius: 2, color: t.TEXT, fontFamily: FONT_MONO, fontSize: 12, boxShadow: '0 10px 28px -8px rgba(224,138,60,.6)' }}
                  labelStyle={{ color: t.GOLD, fontWeight: 700, fontFamily: FONT_DISPLAY, letterSpacing: '.06em', textTransform: 'uppercase' }}
                  itemStyle={{ color: t.TEXT, fontWeight: 700 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
            {byCategory.map((e, i) => (
              <div key={e.name} onClick={() => setActiveIdx((c) => (c === i ? null : i))}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderTop: `1px solid ${t.HAIR}`, cursor: 'pointer', background: activeIdx === i ? 'rgba(224,138,60,.10)' : 'transparent' }}>
                <span style={{ width: 9, height: 9, background: SERIES[i % SERIES.length] }} />
                <span style={{ flex: 1, fontFamily: FONT_BODY, fontSize: 12, fontWeight: activeIdx === i ? 700 : 400, color: activeIdx === i ? t.TEXT : t.TEXT_DIM }}>{e.name}</span>
                <span style={{ fontFamily: FONT_MONO, fontWeight: 600, fontSize: 11, color: t.TEXT, fontVariantNumeric: 'tabular-nums' }}>{num(e.value, activeCur)}</span>
                <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: t.TEXT_FAINT, width: 38, textAlign: 'right' }}>
                  {expense ? Math.round((e.value / expense) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MonthNav({ month, setMonth }) {
  const t = useTheme();
  const atCurrentMonth = month >= monthKey(todayISO()); // не листаем в будущее
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: t.BG_RAISED, clipPath: CUT(9), padding: '8px 12px', marginBottom: 14 }}>
      <button onClick={() => setMonth(shiftMonth(month, -1))} style={iconBtn(t)}><ChevronLeft size={20} /></button>
      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12, letterSpacing: '.14em', color: t.TEXT }}>{fmtMonthShort(month)}</span>
      <button disabled={atCurrentMonth} onClick={() => { if (!atCurrentMonth) setMonth(shiftMonth(month, 1)); }} style={{ ...iconBtn(t), opacity: atCurrentMonth ? 0.25 : 1, cursor: atCurrentMonth ? 'default' : 'pointer' }}><ChevronRight size={20} /></button>
    </div>
  );
}

function StatCard({ label, value, color, sub }) {
  const t = useTheme();
  return (
    <div style={{ flex: 1, background: t.BG_RAISED, padding: '11px 10px', borderLeft: `2px solid ${color}` }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 8, letterSpacing: '.16em', textTransform: 'uppercase', color: t.TEXT_FAINT, marginBottom: 7 }}>{label}</div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontFamily: FONT_MONO, fontSize: 10, fontWeight: 500, color: t.TEXT_FAINT, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{sub}</div>}
    </div>
  );
}

/* ============================================================
   Корневой компонент с авторизацией и загрузкой данных
   ============================================================ */
function Main({ displayName }) {
  const t = useTheme();
  const [tab, setTab] = useState('ops');
  const [txs, setTxs] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [subcategories, setSubcategories] = useState(DEFAULT_SUBCATEGORIES);
  const [month, setMonth] = useState(monthKey(todayISO()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [keyNotice, setKeyNotice] = useState(false);

  const uid = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id;
  }, []);

  // Первичная загрузка: ключ шифрования + данные
  useEffect(() => {
    (async () => {
      try {
        const key = await getKey();
        if (key.__isNew) setKeyNotice(true);
        await loadAll();
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    // настройки (категории)
    const { data: settings } = await supabase.from('app_settings').select('enc, iv').maybeSingle();
    if (settings?.enc) {
      try {
        const dec = await decryptObject(settings);
        if (dec?.categories) setCategories(dec.categories);
        if (dec?.subcategories) setSubcategories(dec.subcategories);
      } catch { /* ключ не подошёл — оставляем дефолт */ }
    }
    // транзакции
    const { data, error } = await supabase
      .from('transactions')
      .select('id, occurred_at, kind, currency, enc, iv')
      .order('occurred_at', { ascending: false });
    if (error) throw error;
    const decrypted = [];
    for (const row of data) {
      try {
        const d = await decryptObject(row);
        decrypted.push({ id: row.id, occurred_at: row.occurred_at, kind: row.kind, currency: row.currency, ...d });
      } catch {
        decrypted.push({ id: row.id, occurred_at: row.occurred_at, kind: row.kind, currency: row.currency, amount: 0, category: '🔒 (не расшифровано)', note: '' });
      }
    }
    setTxs(decrypted);
  }

  async function persistSettings(nextCats, nextSubs) {
    setCategories(nextCats);
    setSubcategories(nextSubs);
    const userId = await uid();
    const payload = await encryptObject({ categories: nextCats, subcategories: nextSubs });
    await supabase.from('app_settings').upsert({ user_id: userId, ...payload });
  }

  // Досоздаёт отсутствующие категории/подкатегории из набора операций (одна запись в БД)
  async function ensureCats(list) {
    let nextCats = categories, nextSubs = subcategories, changed = false;
    for (const d of list) {
      if (d.category && !(nextCats[d.kind] || []).includes(d.category)) {
        nextCats = { ...nextCats, [d.kind]: [...(nextCats[d.kind] || []), d.category] };
        changed = true;
      }
      if (d.subcategory) {
        const cur = nextSubs[d.kind]?.[d.category] || [];
        if (!cur.includes(d.subcategory)) {
          nextSubs = { ...nextSubs, [d.kind]: { ...(nextSubs[d.kind] || {}), [d.category]: [...cur, d.subcategory] } };
          changed = true;
        }
      }
    }
    if (changed) await persistSettings(nextCats, nextSubs);
  }

  // Создать несколько операций сразу (микс доход/расход)
  async function createMany(list) {
    await ensureCats(list);
    for (const d of list) await createTx(d);
  }
  async function updateOne(id, d) {
    await ensureCats([d]);
    await updateTx(id, d);
  }

  async function createTx(data) {
    const userId = await uid();
    const { amount, category, subcategory = '', note, kind, currency, occurred_at } = data;
    const payload = await encryptObject({ amount, category, subcategory, note });
    const { data: row, error } = await supabase
      .from('transactions')
      .insert({ user_id: userId, kind, currency, occurred_at, ...payload })
      .select('id')
      .single();
    if (error) return alert('Ошибка сохранения: ' + error.message);
    setTxs((prev) => [{ id: row.id, kind, currency, occurred_at, amount, category, subcategory, note }, ...prev]);
  }

  async function updateTx(id, data) {
    const { amount, category, subcategory = '', note, kind, currency, occurred_at } = data;
    const payload = await encryptObject({ amount, category, subcategory, note });
    const { error } = await supabase
      .from('transactions')
      .update({ kind, currency, occurred_at, ...payload })
      .eq('id', id);
    if (error) return alert('Ошибка обновления: ' + error.message);
    setTxs((prev) => prev.map((x) => (x.id === id ? { id, kind, currency, occurred_at, amount, category, subcategory, note } : x)));
  }

  async function deleteTx(id) {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) return alert('Ошибка удаления: ' + error.message);
    setTxs((prev) => prev.filter((x) => x.id !== id));
  }

  if (loading) return <CenterScreen><Loader2 size={30} className="spin" color={t.ACCENT} /><span style={{ color: t.TEXT_DIM, fontFamily: FONT_DISPLAY, letterSpacing: '.16em', fontSize: 12, textTransform: 'uppercase' }}>Загрузка…</span></CenterScreen>;
  if (error) return <CenterScreen><X size={30} color={t.ACCENT} /><span style={{ fontFamily: FONT_BODY }}>{error}</span></CenterScreen>;

  return (
    <div style={{
      maxWidth: 560, margin: '0 auto', color: t.TEXT,
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
      paddingLeft: 14, paddingRight: 14, paddingBottom: 96,
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 16 }}>
        <div style={{ width: 32, height: 32, background: t.ACCENT_GRAD, clipPath: CUT(8), display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <Wallet size={17} color={t.ON_ACCENT} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 18, letterSpacing: '.03em' }}>ФИНАНСЫ</div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '.14em', textTransform: 'uppercase', color: t.TEXT_FAINT, marginTop: 3 }}>{displayName || 'FIN·03'}</div>
        </div>
        <span title="Данные зашифрованы" style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: FONT_MONO, fontSize: 9, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: t.TEXT_META }}>
          <ShieldCheck size={13} color={t.POSITIVE} /> шифр
        </span>
      </header>

      {keyNotice && (
        <div style={{
          position: 'relative', background: t.BG_HERO, clipPath: CUT(12), padding: 13,
          marginBottom: 16, fontFamily: FONT_BODY, fontSize: 13, color: t.TEXT_DIM, overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: t.ACCENT_GRAD }} />
          <b style={{ color: t.GOLD, fontFamily: FONT_DISPLAY, letterSpacing: '.04em' }}>Ключ шифрования создан.</b> Он хранится в Telegram и синхронизируется между твоими устройствами.
          Если потеряешь доступ к Telegram-аккаунту — расшифровать данные будет нельзя.
          <div style={{ marginTop: 10 }}>
            <Btn variant="ghost" onClick={() => setKeyNotice(false)} style={{ padding: '7px 14px', fontSize: 11 }}>Понятно</Btn>
          </div>
        </div>
      )}

      {tab === 'ops' && (
        <OperationsTab txs={txs} month={month} setMonth={setMonth} categories={categories} subcategories={subcategories}
          onCreateMany={createMany} onUpdateOne={updateOne} onDelete={deleteTx} />
      )}
      {tab === 'stats' && <StatsTab txs={txs} month={month} setMonth={setMonth} />}

      {/* Нижняя навигация — плавающая пилюля */}
      <nav style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, padding: '10px 14px calc(15px + env(safe-area-inset-bottom))',
        background: 'linear-gradient(to top,#080808 55%,transparent)',
      }}>
        <div style={{ display: 'flex', maxWidth: 560, margin: '0 auto', background: t.BG_RAISED, clipPath: CUT(14), padding: 4 }}>
          {[['ops', 'Операции', ListOrdered], ['stats', 'Статистика', BarChart3]].map(([k, lbl, Icon]) => {
            const on = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)} style={{
                flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                background: on ? t.ACCENT_GRAD : 'transparent', clipPath: on ? CUT(10) : 'none',
                color: on ? t.ON_ACCENT : t.TEXT_META, opacity: on ? 1 : 0.6,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                fontFamily: FONT_DISPLAY, fontSize: 10, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase',
              }}>
                <Icon size={16} /> {lbl}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/* ============================================================
   AuthGate — вход через Telegram Mini App
   ============================================================ */
export default function App() {
  const tg = window.Telegram?.WebApp;
  // Решение редизайна: единая тёмная тема Neo-Vectorheart
  const theme = THEMES.dark;

  const [status, setStatus] = useState('init'); // init | ok | no-tg | error
  const [displayName, setDisplayName] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    document.body.style.background = theme.BG;
    document.body.style.margin = '0';
    document.body.style.fontFamily = FONT_BODY;
  }, [theme]);

  useEffect(() => {
    (async () => {
      if (!supabaseConfigured) { setStatus('error'); setMsg('Supabase не настроен (переменные окружения).'); return; }
      const initData = tg?.initData;
      if (!initData) { setStatus('no-tg'); return; }

      // Уже есть сессия?
      const { data: sess } = await supabase.auth.getSession();
      if (sess?.session) { setStatus('ok'); return; }

      try {
        const resp = await fetch('/api/tg-auth', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData }),
        });
        const json = await resp.json();
        if (!resp.ok) throw new Error(json.error || 'Ошибка авторизации');

        const { error } = await supabase.auth.verifyOtp({ token_hash: json.token_hash, type: 'magiclink' });
        if (error) throw error;
        setDisplayName(json.displayName || '');
        setStatus('ok');
      } catch (e) {
        setStatus('error'); setMsg(String(e.message || e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ThemeContext.Provider value={theme}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Exo+2:wght@600;700;800;900&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        .spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
        .ticker-track{display:inline-flex;align-items:center;white-space:nowrap;will-change:transform;animation:ticker 26s linear infinite}
        @keyframes ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        *{-webkit-tap-highlight-color:transparent} input,select,button{font-family:inherit}
        body{background:${theme.BG}}
      `}</style>
      {status === 'init' && <CenterScreen><Loader2 size={30} className="spin" color={theme.ACCENT} /><span style={{ color: theme.TEXT_DIM, fontFamily: FONT_DISPLAY, letterSpacing: '.16em', fontSize: 12, textTransform: 'uppercase' }}>Вход…</span></CenterScreen>}
      {status === 'no-tg' && (
        <CenterScreen>
          <div style={{ width: 52, height: 52, background: theme.ACCENT_GRAD, clipPath: CUT(12), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Wallet size={26} color={theme.ON_ACCENT} />
          </div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 20, letterSpacing: '.04em' }}>ФИНАНСЫ</div>
          <div style={{ color: theme.TEXT_DIM, fontFamily: FONT_BODY, maxWidth: 320 }}>
            Приложение открывается только внутри Telegram — запусти его через бота.
          </div>
        </CenterScreen>
      )}
      {status === 'error' && (
        <CenterScreen>
          <X size={36} color={theme.ACCENT} />
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase' }}>Не удалось войти</div>
          <div style={{ color: theme.TEXT_DIM, fontFamily: FONT_BODY, fontSize: 14, maxWidth: 340 }}>{msg}</div>
        </CenterScreen>
      )}
      {status === 'ok' && <Main displayName={displayName} />}
    </ThemeContext.Provider>
  );
}
