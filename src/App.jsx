import React, { useState, useEffect, useMemo, createContext, useContext, useCallback } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  Wallet, Plus, TrendingUp, TrendingDown, Trash2, Pencil, X, Check,
  BarChart3, ListOrdered, Settings, ChevronLeft, ChevronRight, Loader2, ShieldCheck,
} from 'lucide-react';
import { supabase, supabaseConfigured } from './supabaseClient.js';
import { getKey, encryptObject, decryptObject } from './lib/crypto.js';

/* ============================================================
   Тема — тёплая тёмная/светлая палитра, акцент гранатовый (единый
   с трекерами тренировок и питания — «семья» приложений).
   ============================================================ */
const ACCENT = '#A8334C';
const POSITIVE = '#5C8A4E';
const THEMES = {
  dark: {
    BG: '#1A1715', BG_RAISED: '#242019', BG_INPUT: '#2D2620', BORDER: '#3D3127',
    ACCENT, ACCENT_SOFT: '#C4566E', POSITIVE, GOLD: '#CC9F3D',
    TEXT: '#EDE6DB', TEXT_DIM: '#A89C8C', TEXT_FAINT: '#766A5C',
  },
  light: {
    BG: '#FBF6EE', BG_RAISED: '#FFFFFF', BG_INPUT: '#F2E9DA', BORDER: '#E0D2BA',
    ACCENT, ACCENT_SOFT: '#8C2A3F', POSITIVE: '#4E7342', GOLD: '#9C7A1F',
    TEXT: '#2A2218', TEXT_DIM: '#5C5040', TEXT_FAINT: '#80735E',
  },
};
const SERIES = ['#A8334C', '#5B8FB0', '#C9A227', '#5C8A4E', '#9B6FB5', '#C97B3F', '#4E8A83', '#B0556F'];

const ThemeContext = createContext(THEMES.dark);
const useTheme = () => useContext(ThemeContext);

/* ============================================================
   Валюты (ISO-коды, чтобы Intl корректно форматировал)
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
const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); }
  catch { return iso; }
};

/* ============================================================
   Примитивы UI
   ============================================================ */
function Field({ label, children }) {
  const t = useTheme();
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 12, color: t.TEXT_DIM, marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}
function inputStyle(t) {
  return {
    width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 16,
    background: t.BG_INPUT, color: t.TEXT, border: `1px solid ${t.BORDER}`,
    borderRadius: 10, outline: 'none',
  };
}
function Btn({ children, onClick, variant = 'primary', style, disabled, type = 'button' }) {
  const t = useTheme();
  const base = {
    border: 'none', borderRadius: 10, padding: '12px 16px', fontSize: 15, fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  };
  const variants = {
    primary: { background: t.ACCENT, color: '#fff' },
    ghost: { background: t.BG_INPUT, color: t.TEXT },
    danger: { background: 'transparent', color: t.ACCENT_SOFT, border: `1px solid ${t.BORDER}` },
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

  const catList = categories[kind] || [];

  async function submit(e) {
    e.preventDefault();
    const num = parseFloat(amount.replace(',', '.'));
    if (!num || num <= 0) return alert('Введи сумму больше нуля');
    if (!category) return alert('Выбери категорию');
    setBusy(true);
    try {
      await onSave({ kind, amount: num, currency, category, occurred_at: date, note: note.trim() });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{
      background: t.BG_RAISED, border: `1px solid ${t.BORDER}`, borderRadius: 14, padding: 16, marginBottom: 16,
    }}>
      {/* Тип */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {[['expense', 'Расход', TrendingDown], ['income', 'Доход', TrendingUp]].map(([k, lbl, Icon]) => (
          <button key={k} type="button" onClick={() => { setKind(k); setCategory(''); }} style={{
            flex: 1, padding: '10px', borderRadius: 10, cursor: 'pointer', fontWeight: 600,
            border: `1px solid ${kind === k ? (k === 'income' ? t.POSITIVE : t.ACCENT) : t.BORDER}`,
            background: kind === k ? (k === 'income' ? t.POSITIVE : t.ACCENT) : 'transparent',
            color: kind === k ? '#fff' : t.TEXT_DIM,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Icon size={16} /> {lbl}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 2 }}>
          <Field label="Сумма">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0" style={inputStyle(t)} autoFocus />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Валюта">
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={inputStyle(t)}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </Field>
        </div>
      </div>

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
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle(t)} />
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
   Вкладка «Операции»
   ============================================================ */
function OperationsTab({ txs, month, setMonth, categories, onCreate, onUpdate, onDelete, onAddCategory }) {
  const t = useTheme();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

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

  return (
    <div>
      <MonthSwitcher month={month} setMonth={setMonth} />

      {/* Сводка */}
      <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
        {Object.keys(totals).length === 0 && (
          <div style={{ color: t.TEXT_FAINT, fontSize: 14, textAlign: 'center', padding: 8 }}>
            Нет операций за этот месяц
          </div>
        )}
        {Object.entries(totals).map(([cur, v]) => (
          <div key={cur} style={{
            background: t.BG_RAISED, border: `1px solid ${t.BORDER}`, borderRadius: 12,
            padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontWeight: 700, color: t.TEXT_DIM }}>{cur}</span>
            <div style={{ display: 'flex', gap: 16, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: t.POSITIVE }}>+{money(v.income, cur)}</span>
              <span style={{ color: t.ACCENT_SOFT }}>−{money(v.expense, cur)}</span>
            </div>
          </div>
        ))}
      </div>

      {!adding && !editing && (
        <Btn onClick={() => setAdding(true)} style={{ width: '100%', marginBottom: 16 }}>
          <Plus size={18} /> Добавить операцию
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

      {/* Список */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {monthTxs.map((x) => (
          <div key={x.id} style={{
            background: t.BG_RAISED, border: `1px solid ${t.BORDER}`, borderRadius: 12, padding: '10px 12px',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{
              width: 6, alignSelf: 'stretch', borderRadius: 4,
              background: x.kind === 'income' ? t.POSITIVE : t.ACCENT,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: t.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {x.category}
              </div>
              <div style={{ fontSize: 12, color: t.TEXT_FAINT }}>
                {fmtDate(x.occurred_at)}{x.note ? ` · ${x.note}` : ''}
              </div>
            </div>
            <div style={{
              fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              color: x.kind === 'income' ? t.POSITIVE : t.TEXT,
            }}>
              {x.kind === 'income' ? '+' : '−'}{money(x.amount, x.currency)}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => { setAdding(false); setEditing(x); }} style={iconBtn(t)}><Pencil size={15} /></button>
              <button onClick={() => { if (confirm('Удалить операцию?')) onDelete(x.id); }} style={iconBtn(t)}><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function iconBtn(t) {
  return { background: 'transparent', border: 'none', color: t.TEXT_FAINT, cursor: 'pointer', padding: 4 };
}

function MonthSwitcher({ month, setMonth }) {
  const t = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <button onClick={() => setMonth(shiftMonth(month, -1))} style={iconBtn(t)}><ChevronLeft size={22} /></button>
      <span style={{ fontWeight: 700, fontSize: 16 }}>{fmtMonth(month)}</span>
      <button onClick={() => setMonth(shiftMonth(month, 1))} style={iconBtn(t)}><ChevronRight size={22} /></button>
    </div>
  );
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

  if (currencies.length === 0) {
    return (
      <div>
        <MonthSwitcher month={month} setMonth={setMonth} />
        <div style={{ color: t.TEXT_FAINT, textAlign: 'center', padding: 40 }}>Нет данных за месяц</div>
      </div>
    );
  }

  return (
    <div>
      <MonthSwitcher month={month} setMonth={setMonth} />

      {currencies.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {currencies.map((c) => (
            <button key={c} onClick={() => setCur(c)} style={{
              padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontWeight: 600, fontSize: 13,
              border: `1px solid ${c === activeCur ? t.ACCENT : t.BORDER}`,
              background: c === activeCur ? t.ACCENT : 'transparent',
              color: c === activeCur ? '#fff' : t.TEXT_DIM,
            }}>{c}</button>
          ))}
        </div>
      )}

      {/* Баланс */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <StatCard label="Доход" value={money(income, activeCur)} color={t.POSITIVE} />
        <StatCard label="Расход" value={money(expense, activeCur)} color={t.ACCENT_SOFT} />
        <StatCard label="Баланс" value={money(income - expense, activeCur)} color={income - expense >= 0 ? t.POSITIVE : t.ACCENT_SOFT} />
      </div>

      {/* Пирог расходов по категориям */}
      {byCategory.length > 0 && (
        <div style={{ background: t.BG_RAISED, border: `1px solid ${t.BORDER}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Расходы по категориям</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {byCategory.map((e, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => money(v, activeCur)}
                contentStyle={{ background: t.BG_INPUT, border: `1px solid ${t.BORDER}`, borderRadius: 8, color: t.TEXT }} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {byCategory.map((e, i) => (
              <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: SERIES[i % SERIES.length] }} />
                <span style={{ flex: 1, color: t.TEXT_DIM }}>{e.name}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(e.value, activeCur)}</span>
                <span style={{ color: t.TEXT_FAINT, width: 44, textAlign: 'right' }}>
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
function StatCard({ label, value, color }) {
  const t = useTheme();
  return (
    <div style={{ flex: 1, background: t.BG_RAISED, border: `1px solid ${t.BORDER}`, borderRadius: 12, padding: '12px 10px' }}>
      <div style={{ fontSize: 11, color: t.TEXT_FAINT, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
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

  if (loading) return <CenterScreen><Loader2 size={30} className="spin" /><span style={{ color: t.TEXT_DIM }}>Загрузка…</span></CenterScreen>;
  if (error) return <CenterScreen><X size={30} color={t.ACCENT} /><span>{error}</span></CenterScreen>;

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 90px', color: t.TEXT }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <Wallet size={24} color={t.ACCENT} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Финансы</div>
          <div style={{ fontSize: 12, color: t.TEXT_FAINT }}>{displayName}</div>
        </div>
        <span title="Данные зашифрованы" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: t.TEXT_FAINT }}>
          <ShieldCheck size={15} color={t.POSITIVE} /> шифр
        </span>
      </header>

      {keyNotice && (
        <div style={{
          background: t.BG_RAISED, border: `1px solid ${t.GOLD}`, borderRadius: 12, padding: 12,
          marginBottom: 16, fontSize: 13, color: t.TEXT_DIM,
        }}>
          <b style={{ color: t.GOLD }}>Ключ шифрования создан.</b> Он хранится в Telegram и синхронизируется между твоими устройствами.
          Если потеряешь доступ к Telegram-аккаунту — расшифровать данные будет нельзя.
          <div style={{ marginTop: 8 }}>
            <Btn variant="ghost" onClick={() => setKeyNotice(false)} style={{ padding: '6px 12px', fontSize: 13 }}>Понятно</Btn>
          </div>
        </div>
      )}

      {tab === 'ops' && (
        <OperationsTab txs={txs} month={month} setMonth={setMonth} categories={categories}
          onCreate={createTx} onUpdate={updateTx} onDelete={deleteTx} onAddCategory={addCategory} />
      )}
      {tab === 'stats' && <StatsTab txs={txs} month={month} setMonth={setMonth} />}

      {/* Нижняя навигация */}
      <nav style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, background: t.BG_RAISED,
        borderTop: `1px solid ${t.BORDER}`, display: 'flex',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {[['ops', 'Операции', ListOrdered], ['stats', 'Статистика', BarChart3]].map(([k, lbl, Icon]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: '12px 0', background: 'transparent', border: 'none', cursor: 'pointer',
            color: tab === k ? t.ACCENT : t.TEXT_FAINT, display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600,
          }}>
            <Icon size={20} /> {lbl}
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ============================================================
   AuthGate — вход через Telegram Mini App
   ============================================================ */
export default function App() {
  const tg = window.Telegram?.WebApp;
  const scheme = tg?.colorScheme === 'light' ? 'light' : 'dark';
  const theme = THEMES[scheme];

  const [status, setStatus] = useState('init'); // init | ok | no-tg | error
  const [displayName, setDisplayName] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    document.body.style.background = theme.BG;
    document.body.style.margin = '0';
    document.body.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
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
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
        *{-webkit-tap-highlight-color:transparent} input,select,button{font-family:inherit}`}</style>
      {status === 'init' && <CenterScreen><Loader2 size={30} className="spin" /><span style={{ color: theme.TEXT_DIM }}>Вход…</span></CenterScreen>}
      {status === 'no-tg' && (
        <CenterScreen>
          <Wallet size={40} color={theme.ACCENT} />
          <div style={{ fontWeight: 700, fontSize: 18 }}>Финансы</div>
          <div style={{ color: theme.TEXT_DIM, maxWidth: 320 }}>
            Приложение открывается только внутри Telegram — запусти его через бота.
          </div>
        </CenterScreen>
      )}
      {status === 'error' && (
        <CenterScreen>
          <X size={36} color={theme.ACCENT} />
          <div style={{ fontWeight: 700 }}>Не удалось войти</div>
          <div style={{ color: theme.TEXT_DIM, fontSize: 14, maxWidth: 340 }}>{msg}</div>
        </CenterScreen>
      )}
      {status === 'ok' && <Main displayName={displayName} />}
    </ThemeContext.Provider>
  );
}
