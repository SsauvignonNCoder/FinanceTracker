import React, { useState, useEffect, useMemo, createContext, useContext, useCallback } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
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
  expense: ['Еда', 'Кафе/рестораны', 'Транспорт', 'Жильё', 'Здоровье', 'Спорт', 'Развлечения', 'Одежда', 'Подарки', 'Другое'],
  income: ['Зарплата', 'Подработка', 'Возврат', 'Подарок', 'Другое'],
};

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
  for (const [code, v] of Object.entries(json.Valute || {})) {
    if (v && v.Value && v.Nominal) rates[code] = v.Value / v.Nominal; // рублей за 1 ед.
  }
  let date = '';
  try { date = new Date(json.Date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }); } catch { /* noop */ }
  _ratesCache = { rates, date };
  return _ratesCache;
}
function useRates() {
  const [state, setState] = useState({ rates: null, date: '' });
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
function TxForm({ initial, categories, onCancel, onSave, onAddCategory }) {
  const t = useTheme();
  const [kind, setKind] = useState(initial?.kind || 'expense');
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '');
  const [currency, setCurrency] = useState(initial?.currency || 'RUB');
  const [category, setCategory] = useState(initial?.category || '');
  const [date, setDate] = useState(initial?.occurred_at || todayISO());
  const [note, setNote] = useState(initial?.note || '');
  const [newCat, setNewCat] = useState('');
  const [busy, setBusy] = useState(false);
  const { rates, date: ratesDate } = useRates();

  const catList = categories[kind] || [];

  // Конвертер: рубль базовый → для не-RUB считаем эквивалент в ₽
  const amountNum = Math.abs(parseFloat((amount || '').replace(',', '.')));
  const rate = rates && currency !== 'RUB' ? rates[currency] : null;
  const rubEquiv = rate && amountNum ? amountNum * rate : null;

  // Ввод суммы: отрицательное значение автоматически помечает операцию как расход
  function onAmountChange(v) {
    setAmount(v);
    const parsed = parseFloat(v.replace(',', '.'));
    if (parsed < 0 && kind !== 'expense') { setKind('expense'); setCategory(''); }
  }

  async function submit(e) {
    e.preventDefault();
    const n = parseFloat(amount.replace(',', '.'));
    if (!n || isNaN(n)) return alert('Введи сумму');
    if (!category) return alert('Выбери категорию');
    setBusy(true);
    try {
      // В БД сумма всегда положительная — знак выражается через kind
      await onSave({ kind, amount: Math.abs(n), currency, category, occurred_at: date, note: note.trim() });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{
      background: t.BG_RAISED, clipPath: CUT(14), padding: 16, marginBottom: 16,
    }}>
      {/* Тип */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {[['expense', 'Расход', TrendingDown, t.ACCENT], ['income', 'Доход', TrendingUp, t.POSITIVE]].map(([k, lbl, Icon, col]) => {
          const on = kind === k;
          return (
            <button key={k} type="button" onClick={() => { setKind(k); setCategory(''); }} style={{
              flex: 1, padding: '11px', border: 'none', clipPath: CUT(8), cursor: 'pointer',
              fontWeight: 800, fontFamily: FONT_DISPLAY, letterSpacing: '.06em', textTransform: 'uppercase', fontSize: 12,
              background: on ? (k === 'income' ? t.POSITIVE : t.ACCENT_GRAD) : t.BG_INPUT,
              color: on ? t.ON_ACCENT : t.TEXT_DIM,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Icon size={16} /> {lbl}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 2 }}>
          <Field label="Сумма">
            <input inputMode="decimal" value={amount} onChange={(e) => onAmountChange(e.target.value)}
              placeholder="0" style={{ ...inputStyle(t), fontFamily: FONT_MONO, fontWeight: 600 }} autoFocus />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Валюта">
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ ...inputStyle(t), fontFamily: FONT_MONO }}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {/* Конвертер валют (курс ЦБ РФ). Рубль базовый — показываем эквивалент в ₽ */}
      {rate && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          background: t.BG_HERO, clipPath: CUT(8), padding: '9px 12px', marginBottom: 12,
          borderLeft: `2px solid ${t.ACCENT}`,
        }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '.04em', color: t.TEXT_META }}>
            1 {currency} = {fmtRub(rate)} ₽{ratesDate ? ` · ЦБ РФ ${ratesDate}` : ''}
          </span>
          {rubEquiv != null && (
            <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13, color: t.TEXT, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              ≈ {fmtRub(rubEquiv)} ₽
            </span>
          )}
        </div>
      )}

      <Field label="Категория">
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle(t)}>
          <option value="">— выбери —</option>
          {catList.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Новая категория"
          style={{ ...inputStyle(t), flex: 1 }} />
        <Btn variant="ghost" onClick={() => { if (newCat.trim()) { onAddCategory(kind, newCat.trim()); setCategory(newCat.trim()); setNewCat(''); } }}>
          <Plus size={16} />
        </Btn>
      </div>

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

      <Field label="Заметка (необязательно)">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Комментарий" style={inputStyle(t)} />
      </Field>

      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <Btn variant="ghost" onClick={onCancel} style={{ flex: 1 }}>Отмена</Btn>
        <Btn type="submit" disabled={busy} style={{ flex: 2 }}>
          {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Сохранить
        </Btn>
      </div>
    </form>
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
   Вкладка «Операции»
   ============================================================ */
function OperationsTab({ txs, month, setMonth, categories, onCreate, onUpdate, onDelete, onAddCategory }) {
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
        <TxForm categories={categories} onCancel={() => setAdding(false)} onAddCategory={onAddCategory}
          onSave={async (data) => { await onCreate(data); setAdding(false); }} />
      )}
      {editing && (
        <TxForm initial={editing} categories={categories} onCancel={() => setEditing(null)} onAddCategory={onAddCategory}
          onSave={async (data) => { await onUpdate(editing.id, data); setEditing(null); }} />
      )}

      {/* Журнал */}
      {monthTxs.length > 0 && <HudLabel right={String(monthTxs.length).padStart(2, '0')}>Журнал</HudLabel>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {monthTxs.map((x) => {
          const inc = x.kind === 'income';
          return (
            <div key={x.id} style={{
              background: t.BG_RAISED, clipPath: CUT_TL(14), padding: '10px 12px 10px 6px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ width: 5, alignSelf: 'stretch', marginLeft: 8, transform: 'skewX(-18deg)', background: inc ? t.POSITIVE : t.ACCENT }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: t.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {x.category}
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '.06em', color: t.TEXT_FAINT, marginTop: 2 }}>
                  {fmtDate(x.occurred_at)}{x.note ? ` · ${x.note.toUpperCase()}` : ''}
                </div>
              </div>
              <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums', color: inc ? t.POSITIVE : t.TEXT }}>
                {inc ? '+' : '−'}{num(x.amount, x.currency)}
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                <button onClick={() => { setAdding(false); setEditing(x); }} style={iconBtn(t)}><Pencil size={14} /></button>
                <button onClick={() => { if (confirm('Удалить операцию?')) onDelete(x.id); }} style={iconBtn(t)}><Trash2 size={14} /></button>
              </div>
            </div>
          );
        })}
      </div>
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
function StatsTab({ txs, month, setMonth }) {
  const t = useTheme();
  const [cur, setCur] = useState(null);

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

      {/* Карточки */}
      <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
        <StatCard label="Доход" value={num(income, activeCur)} color={t.POSITIVE} />
        <StatCard label="Расход" value={num(expense, activeCur)} color={t.ACCENT} />
        <StatCard label="Баланс" value={`${income - expense >= 0 ? '+' : '−'}${num(Math.abs(income - expense), activeCur)}`} color={t.TEXT} />
      </div>

      {/* Пончик расходов */}
      {byCategory.length > 0 && (
        <div style={{ position: 'relative', background: t.BG_HERO, clipPath: CUT_BR(20, 36), padding: '15px 16px 18px', marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, backgroundImage: HATCH('rgba(255,255,255,.03)', 12), pointerEvents: 'none' }} />
          <div style={{ position: 'relative' }}><HudLabel>Расходы · категории</HudLabel></div>
          <div style={{ position: 'relative', width: '100%', maxWidth: 320, margin: '0 auto' }}>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={52} outerRadius={88} paddingAngle={2} stroke="none">
                  {byCategory.map((e, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => money(v, activeCur)}
                  contentStyle={{ background: t.BG_INPUT, border: `1px solid ${t.BORDER}`, borderRadius: 0, clipPath: CUT(6), color: t.TEXT, fontFamily: FONT_MONO, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
            {byCategory.map((e, i) => (
              <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: `1px solid ${t.HAIR}` }}>
                <span style={{ width: 9, height: 9, background: SERIES[i % SERIES.length] }} />
                <span style={{ flex: 1, fontFamily: FONT_BODY, fontSize: 12, color: t.TEXT_DIM }}>{e.name}</span>
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

function StatCard({ label, value, color }) {
  const t = useTheme();
  return (
    <div style={{ flex: 1, background: t.BG_RAISED, padding: '11px 10px', borderLeft: `2px solid ${color}` }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 8, letterSpacing: '.16em', textTransform: 'uppercase', color: t.TEXT_FAINT, marginBottom: 7 }}>{label}</div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
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

  async function persistCategories(next) {
    setCategories(next);
    const userId = await uid();
    const payload = await encryptObject({ categories: next });
    await supabase.from('app_settings').upsert({ user_id: userId, ...payload });
  }

  async function addCategory(kind, name) {
    if (categories[kind]?.includes(name)) return;
    persistCategories({ ...categories, [kind]: [...(categories[kind] || []), name] });
  }

  async function createTx(data) {
    const userId = await uid();
    const { amount, category, note, kind, currency, occurred_at } = data;
    const payload = await encryptObject({ amount, category, note });
    const { data: row, error } = await supabase
      .from('transactions')
      .insert({ user_id: userId, kind, currency, occurred_at, ...payload })
      .select('id')
      .single();
    if (error) return alert('Ошибка сохранения: ' + error.message);
    setTxs((prev) => [{ id: row.id, kind, currency, occurred_at, amount, category, note }, ...prev]);
  }

  async function updateTx(id, data) {
    const { amount, category, note, kind, currency, occurred_at } = data;
    const payload = await encryptObject({ amount, category, note });
    const { error } = await supabase
      .from('transactions')
      .update({ kind, currency, occurred_at, ...payload })
      .eq('id', id);
    if (error) return alert('Ошибка обновления: ' + error.message);
    setTxs((prev) => prev.map((x) => (x.id === id ? { id, kind, currency, occurred_at, amount, category, note } : x)));
  }

  async function deleteTx(id) {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) return alert('Ошибка удаления: ' + error.message);
    setTxs((prev) => prev.filter((x) => x.id !== id));
  }

  if (loading) return <CenterScreen><Loader2 size={30} className="spin" color={t.ACCENT} /><span style={{ color: t.TEXT_DIM, fontFamily: FONT_DISPLAY, letterSpacing: '.16em', fontSize: 12, textTransform: 'uppercase' }}>Загрузка…</span></CenterScreen>;
  if (error) return <CenterScreen><X size={30} color={t.ACCENT} /><span style={{ fontFamily: FONT_BODY }}>{error}</span></CenterScreen>;

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '14px 14px 96px', color: t.TEXT }}>
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
        <OperationsTab txs={txs} month={month} setMonth={setMonth} categories={categories}
          onCreate={createTx} onUpdate={updateTx} onDelete={deleteTx} onAddCategory={addCategory} />
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
