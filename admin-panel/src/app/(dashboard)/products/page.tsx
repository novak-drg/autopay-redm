'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Category { id: number; slug: string; label: string; sort_order: number; active: number; }

interface Product {
  id: string; label: string; description: string; currency: string;
  amount_cents: number; display_price: string; diamond_cost: number | null;
  image: string; category: string; bonus: number | null;
  sort_order: number; active: number;
  reward_json?: RewardEntry[];
}

type RewardType = 'diamond' | 'gold' | 'rol' | 'item' | 'vip' | 'custom';

interface CustomParam { key: string; value: string; }

interface RewardEntry {
  _key:      string;
  type:      RewardType;
  amount?:   number;
  item?:     string;
  vip?:      string;
  // custom fields
  rewardId?: string;
  params?:   CustomParam[];
}

interface ProductForm {
  id: string; label: string; description: string;
  currency: string; brlPrice: string; displayPrice: string;
  diamondCost: string; image: string; category: string;
  bonus: string; sortOrder: string;
  rewards: RewardEntry[];
}

const BLANK_FORM: ProductForm = {
  id: '', label: '', description: '', currency: 'real_money',
  brlPrice: '', displayPrice: '', diamondCost: '', image: '',
  category: '', bonus: '', sortOrder: '0', rewards: [],
};

const BLANK_CAT = { slug: '', label: '', sort_order: 0 };

// ─── Constants ───────────────────────────────────────────────────────────────

const CURRENCY_OPTIONS = [
  { value: 'real_money', label: 'Dinheiro Real (R$)' },
  { value: 'diamond',    label: 'Diamantes' },
  { value: 'gold',       label: 'Gold (moeda do jogo)' },
  { value: 'dollar',     label: 'Dólar' },
];

const REWARD_TYPES: { value: RewardType; label: string; fields: string[] }[] = [
  { value: 'diamond', label: 'Diamantes',            fields: ['amount'] },
  { value: 'gold',    label: 'Gold',                  fields: ['amount'] },
  { value: 'rol',     label: 'Dinheiro (Rol/Cash)',   fields: ['amount'] },
  { value: 'item',    label: 'Item do inventário',    fields: ['item', 'amount'] },
  { value: 'vip',     label: 'VIP',                  fields: ['vip'] },
  { value: 'custom',  label: 'Custom (servidor)',     fields: ['custom'] },
];

// Fallback para ambientes sem HTTPS (onde crypto.randomUUID() não existe no browser)
function generateKey() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Helper — converte reward_json do banco (snake_case) em RewardEntry[] com _key
function normalizeRewards(raw: unknown): RewardEntry[] {
  let parsed = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = [];
    }
  }

  const arr = Array.isArray(parsed) ? parsed : [];

  return arr.map((r: unknown) => {
    const entry = r as Record<string, unknown>;
    const base: RewardEntry = {
      _key:  generateKey(),
      type:  (entry.type as RewardType) ?? 'diamond',
    };
    if (entry.amount   !== undefined) base.amount   = entry.amount   as number;
    if (entry.item     !== undefined) base.item     = entry.item     as string;
    if (entry.vip      !== undefined) base.vip      = entry.vip      as string;
    if (entry.rewardId !== undefined) base.rewardId = entry.rewardId as string;
    if (entry.params   !== undefined) base.params   = entry.params   as CustomParam[];
    return base;
  });
}

// ─── Sub-components (OUTSIDE page — prevents React remount on each render) ──

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel = 'Confirmar', onConfirm, onCancel }:
  { title: string; message: React.ReactNode; confirmLabel?: string; onConfirm: () => void; onCancel: () => void; }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="text-base font-semibold text-white mb-2">{title}</h2>
        <div className="text-sm text-slate-400 mb-6">{message}</div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="btn-ghost flex-1">Cancelar</button>
          <button onClick={onConfirm} className="flex-1 btn-primary bg-red-600 hover:bg-red-500">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Custom Reward Modal ─────────────────────────────────────────────────────

function CustomRewardModal({ entry, onSave, onCancel }: {
  entry: RewardEntry;
  onSave: (patch: Partial<RewardEntry>) => void;
  onCancel: () => void;
}) {
  const [rewardId, setRewardId] = useState(entry.rewardId ?? '');
  const [params,   setParams]   = useState<CustomParam[]>(entry.params ?? []);

  const addParam  = () => setParams(p => [...p, { key: '', value: '' }]);
  const removeParam = (i: number) => setParams(p => p.filter((_, idx) => idx !== i));
  const updateParam = (i: number, field: 'key' | 'value', val: string) =>
    setParams(p => p.map((item, idx) => idx === i ? { ...item, [field]: val } : item));

  const handleSave = () => {
    if (!rewardId.trim()) return;
    onSave({ rewardId: rewardId.trim(), params });
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-surface-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Recompensa Custom
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">O servidor tratará este evento com os parâmetros definidos</p>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              ID da Recompensa (rewardId) *
            </label>
            <input
              type="text"
              value={rewardId}
              onChange={e => setRewardId(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
              className="input-field font-mono"
              placeholder="addHorse, addVehicle, jamjalie..."
              maxLength={64}
            />
            <p className="text-xs text-slate-500 mt-1">
              O servidor vai receber o evento <code className="text-brand-400">pause:customReward</code> com este ID e os parâmetros abaixo.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-400">Parâmetros (opcional)</label>
              <button type="button" onClick={addParam}
                className="text-xs text-brand-400 hover:text-brand-300 font-medium flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add param
              </button>
            </div>

            {params.length === 0 && (
              <div className="text-center py-3 border border-dashed border-slate-600 rounded-lg text-xs text-slate-500">
                Nenhum parâmetro. O servidor receberá apenas o rewardId.
              </div>
            )}

            <div className="space-y-2">
              {params.map((p, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={p.key}
                    onChange={e => updateParam(i, 'key', e.target.value)}
                    className="input-field text-sm flex-1 font-mono"
                    placeholder="chave"
                  />
                  <span className="text-slate-500 text-xs">=</span>
                  <input
                    type="text"
                    value={p.value}
                    onChange={e => updateParam(i, 'value', e.target.value)}
                    className="input-field text-sm flex-1"
                    placeholder="valor"
                  />
                  <button type="button" onClick={() => removeParam(i)}
                    className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface-700/50 border border-slate-600 rounded-lg p-3">
            <p className="text-xs font-medium text-slate-400 mb-1">Preview do payload enviado ao servidor:</p>
            <pre className="text-xs text-brand-300 font-mono whitespace-pre-wrap break-all">{JSON.stringify({
              type: 'custom',
              rewardId: rewardId || '(vazio)',
              params: params.reduce((acc, p) => ({ ...acc, [p.key || '?']: p.value }), {}),
            }, null, 2)}</pre>
          </div>
        </div>

        <div className="flex gap-3 p-5 border-t border-slate-700">
          <button onClick={onCancel} className="btn-ghost flex-1">Cancelar</button>
          <button onClick={handleSave} disabled={!rewardId.trim()}
            className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed">
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reward Builder ──────────────────────────────────────────────────────────

function RewardBuilder({ rewards, onChange }: {
  rewards: RewardEntry[];
  onChange: (r: RewardEntry[]) => void;
}) {
  const [customEditing, setCustomEditing] = useState<string | null>(null);

  const add = () => {
    onChange([...rewards, { _key: generateKey(), type: 'diamond', amount: 1 }]);
  };

  const remove = (key: string) => onChange(rewards.filter(r => r._key !== key));

  const update = (key: string, patch: Partial<RewardEntry>) => {
    onChange(rewards.map(r => r._key === key ? { ...r, ...patch } : r));
  };

  const changeType = (key: string, type: RewardType) => {
    const base: RewardEntry = { _key: key, type };
    if (['diamond','gold','rol'].includes(type)) base.amount = 1;
    if (type === 'item')   { base.item   = ''; base.amount = 1; }
    if (type === 'vip')    base.vip = '';
    if (type === 'custom') { base.rewardId = ''; base.params = []; }
    onChange(rewards.map(r => r._key === key ? base : r));
  };

  const customEntry = customEditing ? rewards.find(r => r._key === customEditing) : null;

  return (
    <>
      {customEntry && (
        <CustomRewardModal
          entry={customEntry}
          onSave={patch => { update(customEntry._key, patch); setCustomEditing(null); }}
          onCancel={() => setCustomEditing(null)}
        />
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-slate-400">Recompensas ao comprar *</span>
          <button type="button" onClick={add}
            className="text-xs text-brand-400 hover:text-brand-300 font-medium transition-colors flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Adicionar
          </button>
        </div>

        {rewards.length === 0 && (
          <div className="text-center py-4 border border-dashed border-slate-600 rounded-lg text-xs text-slate-500">
            Nenhuma recompensa. Clique em "+ Adicionar".
          </div>
        )}

        {rewards.map((r) => {
          const meta = REWARD_TYPES.find(t => t.value === r.type) ?? REWARD_TYPES[0];
          const isCustom = r.type === 'custom';
          return (
            <div key={r._key} className="bg-surface-700/50 border border-slate-700 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <select value={r.type} onChange={e => changeType(r._key, e.target.value as RewardType)}
                  className="input-field text-sm flex-1">
                  {REWARD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {isCustom && (
                  <button type="button" onClick={() => setCustomEditing(r._key)}
                    className="px-2.5 py-1.5 rounded-lg bg-brand-600/20 border border-brand-500/40 text-brand-300 hover:bg-brand-600/40 transition-colors text-xs font-medium flex-shrink-0 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Configurar
                  </button>
                )}
                <button type="button" onClick={() => remove(r._key)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {isCustom && (
                <div className="bg-surface-700 border border-slate-600 rounded-lg p-2.5">
                  {r.rewardId ? (
                    <div className="space-y-1">
                      <p className="text-xs text-slate-400">
                        ID: <span className="text-brand-300 font-mono font-medium">{r.rewardId}</span>
                      </p>
                      {r.params && r.params.length > 0 && (
                        <p className="text-xs text-slate-500">
                          Params: {r.params.map(p => `${p.key}=${p.value}`).join(', ')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-amber-400 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Clique em "Configurar" para definir o rewardId e parâmetros.
                    </p>
                  )}
                </div>
              )}

              {meta.fields.includes('item') && (
                <input type="text" placeholder="ID do item (ex: bread)" value={r.item ?? ''}
                  onChange={e => update(r._key, { item: e.target.value })}
                  className="input-field text-sm" />
              )}
              {meta.fields.includes('vip') && (
                <input type="text" placeholder="ID do VIP (ex: VipBronze)" value={r.vip ?? ''}
                  onChange={e => update(r._key, { vip: e.target.value })}
                  className="input-field text-sm" />
              )}
              {meta.fields.includes('amount') && (
                <input type="number" min={1} placeholder="Quantidade" value={r.amount ?? 1}
                  onChange={e => update(r._key, { amount: Math.max(1, parseInt(e.target.value) || 1) })}
                  className="input-field text-sm" />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const [tab, setTab] = useState<'products' | 'categories'>('products');
  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1 mb-2">
        <h1 className="text-2xl font-bold tracking-tight text-white">Produtos</h1>
        <p className="text-sm tracking-wide text-slate-400">Gerencie produtos da loja, pacotes e status</p>
      </div>
        <div className="flex gap-1 bg-surface-700 rounded-lg p-1">
          {(['products', 'categories'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                tab === t ? 'bg-brand-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>
              {t === 'products' ? 'Produtos' : 'Categorias'}
            </button>
          ))}
        </div>
      </div>
      {tab === 'products' ? <ProductsTab /> : <CategoriesTab />}
    </div>
  );
}

// ─── Products Tab ─────────────────────────────────────────────────────────────

function ProductsTab() {
  const [products,   setProducts]   = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [modal,      setModal]      = useState<'create' | 'edit' | null>(null);
  const [form,       setForm]       = useState<ProductForm>(BLANK_FORM);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [confirm,    setConfirm]    = useState<{ id: string, hard: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        api.get<{ products: Product[] }>('/v1/admin/products'),
        api.get<{ data: Category[] }>('/v1/admin/categories'),
      ]);
      setProducts(p.products ?? []);
      setCategories(c.data ?? []);
    } catch { /* 401 handled globally */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm(BLANK_FORM); setError(''); setModal('create'); };
  const openEdit   = async (p: Product) => {
    setError('');
    // Busca o produto completo (inclui reward_json) para carregar rewards no form
    let rewards: RewardEntry[] = [];
    try {
      const full = await api.get<{ product: Product & { reward_json: unknown } }>(
        `/v1/admin/products/${encodeURIComponent(p.id)}`
      );
      rewards = normalizeRewards(full.product.reward_json ?? []);
    } catch { /* se falhar, abre sem rewards */ }

    setForm({
      id: p.id, label: p.label, description: p.description, currency: p.currency,
      brlPrice: formatPriceByCurrency(p.amount_cents, p.currency),
      displayPrice: p.display_price,
      diamondCost: p.diamond_cost !== null ? String(p.diamond_cost) : '',
      image: p.image, category: p.category,
      bonus: p.bonus !== null ? String(p.bonus) : '',
      sortOrder: String(p.sort_order),
      rewards,
    });
    setModal('edit');
  };

  const parsePriceByCurrency = (val: string, currency: string): number => {
    if (currency === 'diamond' || currency === 'gold') {
      const clean = val.replace(/[^\d]/g, '');
      return parseInt(clean || '0', 10);
    }
    const clean = val.replace(/[^\d,.]/g, '').replace(',', '.');
    return Math.round(parseFloat(clean || '0') * 100);
  };

  const formatPriceByCurrency = (val: number, currency: string): string => {
    if (val <= 0) return '';
    if (currency === 'diamond' || currency === 'gold') {
      return String(val);
    }
    return (val / 100).toFixed(2).replace('.', ',');
  };

  // Build reward payload for API — sem o campo interno _key
  const buildRewardPayload = (rewards: RewardEntry[]) =>
    rewards.map(r => {
      const base: Record<string, unknown> = { type: r.type };
      if (['diamond','gold','rol'].includes(r.type)) base.amount = r.amount ?? 1;
      if (r.type === 'item')   { base.item   = r.item;   base.amount = r.amount ?? 1; }
      if (r.type === 'vip')    base.vip = r.vip;
      if (r.type === 'custom') {
        base.rewardId = r.rewardId ?? '';
        // Converte array de params em objeto chave-valor
        base.params = (r.params ?? []).reduce(
          (acc: Record<string, string>, p) => ({ ...acc, [p.key]: p.value }),
          {}
        );
      }
      return base;
    });

  const handleSave = async () => {
    setError('');

    // Client-side validation
    if (modal === 'create') {
      if (!form.id) { setError('ID é obrigatório.'); return; }
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(form.id)) {
        setError('ID inválido. Use apenas letras, números, _ e -. Sem espaços.');
        return;
      }
    }
    if (!form.label)       { setError('Nome é obrigatório.'); return; }
    if (!form.description) { setError('Descrição é obrigatória.'); return; }
    if (!form.category)    { setError('Categoria é obrigatória.'); return; }
    if (form.rewards.length === 0) { setError('Adicione pelo menos 1 recompensa.'); return; }
    // Validação de custom rewards: rewardId obrigatório
    const invalidCustom = form.rewards.find(r => r.type === 'custom' && !r.rewardId?.trim());
    if (invalidCustom) { setError('Um reward do tipo "custom" está sem rewardId configurado. Clique em "Configurar".'); return; }

    const cents = parsePriceByCurrency(form.brlPrice, form.currency);
    setSaving(true);
    try {
      await api.post('/v1/admin/products', {
        id:          form.id,
        label:       form.label,
        description: form.description,
        currency:    form.currency,
        amountCents: cents,
        displayPrice: form.displayPrice || (cents > 0
          ? (form.currency === 'diamond' || form.currency === 'gold'
              ? `${cents} ${form.currency === 'diamond' ? 'Diamantes' : 'Gold'}`
              : `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`)
          : ''),
        diamondCost: form.diamondCost ? parseInt(form.diamondCost) : null,
        image:       form.image,
        category:    form.category,
        bonus:       form.bonus ? parseInt(form.bonus) : null,
        sortOrder:   parseInt(form.sortOrder) || 0,
        reward:      buildRewardPayload(form.rewards),
      });
      setModal(null);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao salvar.';
      if (msg.startsWith('validation_failed::')) {
        setError(`Erro de validação — ${msg.replace('validation_failed::', '')}`);
      } else if (msg === 'validation_failed') {
        setError('Dados inválidos. Verifique: ID (sem espaços), categoria em slug, recompensas preenchidas.');
      } else {
        setError(msg);
      }
    } finally { setSaving(false); }
  };

  const handleDeactivate = async (id: string, hard: boolean) => {
    try { await api.delete(`/v1/admin/products/${encodeURIComponent(id)}${hard ? '?hard=true' : ''}`); setConfirm(null); await load(); }
    catch { /* handled */ }
  };

  return (
    <>
      <div className="flex justify-end">
        <button onClick={openCreate} className="btn-primary">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Novo Produto
        </button>
      </div>

      <div className="rounded-2xl overflow-hidden mt-6" style={{ background: '#131522', border: '1px solid rgba(255,255,255,0.04)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
        <div className="flex items-center gap-2 p-6 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-500/10 border border-brand-500/20 text-brand-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
          </div>
          <h2 className="text-base font-semibold tracking-wide text-white">Lista de Produtos</h2>
        </div>
        {loading ? <LoadingSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#181a29]/80 border-b border-slate-700/50">
                <tr>{['ID', 'Nome', 'Categoria', 'Tipo de Pagamento', 'Preço', 'Status', 'Ações'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {products.map(p => {
                  const currLabel = CURRENCY_OPTIONS.find(c => c.value === p.currency)?.label ?? p.currency;
                  return (
                    <tr key={p.id} className="hover:bg-surface-700/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{p.id}</td>
                      <td className="px-4 py-3">
                        <p className="text-white text-sm font-medium">{p.label}</p>
                        <p className="text-slate-500 text-xs truncate max-w-[160px]">{p.description}</p>
                      </td>
                      <td className="px-4 py-3"><span className="badge-blue">{p.category}</span></td>
                      <td className="px-4 py-3 text-slate-300 text-xs">{currLabel}</td>
                      <td className="px-4 py-3 text-white font-medium">
                        {p.display_price || (p.amount_cents > 0
                          ? (p.currency === 'diamond' || p.currency === 'gold'
                              ? `${p.amount_cents} ${p.currency === 'diamond' ? 'Diamantes' : 'Gold'}`
                              : `R$ ${(p.amount_cents / 100).toFixed(2).replace('.', ',')}`)
                          : '—')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={p.active ? 'badge-green' : 'badge-red'}>{p.active ? 'Ativo' : 'Inativo'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-600 transition-colors">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                            </svg>
                          </button>
                          <button onClick={() => setConfirm({ id: p.id, hard: false })} className="p-1.5 rounded-lg text-slate-400 hover:text-orange-400 hover:bg-orange-500/10 transition-colors" title={p.active === 1 ? 'Desativar' : 'Manter inativo'}>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                          </button>
                          <button onClick={() => setConfirm({ id: p.id, hard: true })} className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Deletar permanentemente">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!products.length && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500 text-sm">Nenhum produto cadastrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Product Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-700 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-white">{modal === 'create' ? 'Novo Produto' : `Editando: ${form.id}`}</h2>
                <p className="text-xs text-slate-400 mt-0.5">Preencha os dados e adicione as recompensas</p>
              </div>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 p-5 space-y-5">

              {/* Informações básicas */}
              <div>
                <p className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-3">Informações</p>
                <div className="space-y-3">
                  {modal === 'create' && (
                    <Field label="ID do Produto *">
                      <input type="text" value={form.id} maxLength={64}
                        onChange={e => setForm(f => ({
                          ...f,
                          id: e.target.value
                            .toLowerCase()
                            .replace(/\s+/g, '_')
                            .replace(/[^a-z0-9_-]/g, '')
                        }))}
                        className="input-field font-mono" placeholder="pack_500_diamonds" />
                      <p className="text-xs text-slate-500 mt-0.5">Letras, números, _ e - apenas. Espaços viram _</p>
                    </Field>
                  )}
                  <Field label="Nome *">
                    <input type="text" value={form.label} maxLength={255}
                      onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                      className="input-field" placeholder="Pack 500 Diamantes" />
                  </Field>
                  <Field label="Descrição *">
                    <textarea value={form.description} maxLength={1000} rows={2}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      className="input-field resize-none" placeholder="Descrição do produto..." />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Categoria *">
                      <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="input-field">
                        <option value="">Selecione...</option>
                        {categories.filter(c => c.active).map(c => (
                          <option key={c.slug} value={c.slug}>{c.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Ordem">
                      <input type="number" min={0} value={form.sortOrder}
                        onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))}
                        className="input-field" />
                    </Field>
                  </div>
                  <Field label="Imagem (path)">
                    <input type="text" value={form.image} maxLength={512}
                      onChange={e => setForm(f => ({ ...f, image: e.target.value }))}
                      className="input-field" placeholder="icons/pack.png" />
                  </Field>
                </div>
              </div>

              {/* Preço */}
              <div>
                <p className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-3">Preço</p>
                <div className="space-y-3">
                  <Field label="Tipo de Pagamento *">
                    <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} className="input-field">
                      {CURRENCY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Valor (R$ ou moeda)">
                      <input type="text" value={form.brlPrice} maxLength={12}
                        onChange={e => setForm(f => ({ ...f, brlPrice: e.target.value }))}
                        className="input-field" placeholder="29,90" />
                      <p className="text-xs text-slate-500 mt-0.5">Use vírgula: 29,90 = R$29,90</p>
                    </Field>
                    <Field label="Texto exibido (opcional)">
                      <input type="text" value={form.displayPrice} maxLength={64}
                        onChange={e => setForm(f => ({ ...f, displayPrice: e.target.value }))}
                        className="input-field" placeholder="R$ 29,90" />
                      <p className="text-xs text-slate-500 mt-0.5">Se vazio, usa o valor acima</p>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Custo em Diamantes (alternativo)">
                      <input type="number" min={0} value={form.diamondCost}
                        onChange={e => setForm(f => ({ ...f, diamondCost: e.target.value }))}
                        className="input-field" placeholder="Opcional" />
                    </Field>
                    <Field label="Bônus (%)">
                      <input type="number" min={0} value={form.bonus}
                        onChange={e => setForm(f => ({ ...f, bonus: e.target.value }))}
                        className="input-field" placeholder="Opcional" />
                    </Field>
                  </div>
                </div>
              </div>

              {/* Recompensas */}
              <div>
                <p className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-3">Recompensas ao Comprar</p>
                <RewardBuilder
                  rewards={form.rewards}
                  onChange={rewards => setForm(f => ({ ...f, rewards }))}
                />
              </div>

              {error && (
                <div className="px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-700 flex-shrink-0">
              <button onClick={() => setModal(null)} className="btn-ghost">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? 'Salvando...' : 'Salvar Produto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.hard ? "Deletar Produto?" : "Desativar Produto?"}
          message={<>O produto <span className="text-white font-medium">{confirm.id}</span> será {confirm.hard ? 'apagado permanentemente. Essa ação não pode ser desfeita.' : 'marcado como inativo.'}</>}
          confirmLabel={confirm.hard ? "Deletar Permanente" : "Desativar"}
          onConfirm={() => handleDeactivate(confirm.id, confirm.hard)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}

// ─── Categories Tab ────────────────────────────────────────────────────────────

function CategoriesTab() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [modal,      setModal]      = useState<'create' | 'edit' | null>(null);
  const [form,       setForm]       = useState(BLANK_CAT);
  const [editId,     setEditId]     = useState<number | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [confirm,    setConfirm]    = useState<{ id: number, hard: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api.get<{ data: Category[] }>('/v1/admin/categories'); setCategories(d.data ?? []); }
    catch { /* handled */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm(BLANK_CAT); setEditId(null); setError(''); setModal('create'); };
  const openEdit   = (c: Category) => { setForm({ slug: c.slug, label: c.label, sort_order: c.sort_order }); setEditId(c.id); setError(''); setModal('edit'); };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      if (modal === 'create') await api.post('/v1/admin/categories', form);
      else await api.put(`/v1/admin/categories/${editId}`, form);
      setModal(null); await load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Erro ao salvar.'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number, hard: boolean) => {
    try { await api.delete(`/v1/admin/categories/${id}${hard ? '?hard=true' : ''}`); setConfirm(null); await load(); }
    catch { /* handled */ }
  };

  return (
    <>
      <div className="flex justify-end">
        <button onClick={openCreate} className="btn-primary">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Nova Categoria
        </button>
      </div>

      <div className="rounded-2xl overflow-hidden mt-6" style={{ background: '#131522', border: '1px solid rgba(255,255,255,0.04)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
        <div className="flex items-center gap-2 p-6 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-500/10 border border-brand-500/20 text-brand-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>
          </div>
          <h2 className="text-base font-semibold tracking-wide text-white">Categorias Existentes</h2>
        </div>

        {loading ? <LoadingSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#181a29]/80 border-b border-slate-700/50">
                <tr>{['Slug', 'Nome', 'Ordem', 'Status', 'Ações'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {categories.map(c => (
                  <tr key={c.id} className="hover:bg-surface-700/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{c.slug}</td>
                    <td className="px-4 py-3 text-white font-medium">{c.label}</td>
                    <td className="px-4 py-3 text-slate-300">{c.sort_order}</td>
                    <td className="px-4 py-3"><span className={c.active ? 'badge-green' : 'badge-red'}>{c.active ? 'Ativa' : 'Inativa'}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-600 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                          </svg>
                        </button>
                        <button onClick={() => setConfirm({ id: c.id, hard: false })} className="p-1.5 rounded-lg text-slate-400 hover:text-orange-400 hover:bg-orange-500/10 transition-colors" title={c.active ? 'Desativar' : 'Manter inativo'}>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                          </svg>
                        </button>
                        <button onClick={() => setConfirm({ id: c.id, hard: true })} className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Deletar permanentemente">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!categories.length && <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-500 text-sm">Nenhuma categoria cadastrada.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h2 className="text-base font-semibold text-white">{modal === 'create' ? 'Nova Categoria' : 'Editar Categoria'}</h2>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <Field label="Slug *">
                <input type="text" value={form.slug} maxLength={64}
                  onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s/g, '_') }))}
                  className="input-field" placeholder="gold_packs" disabled={modal === 'edit'} />
              </Field>
              <Field label="Nome *">
                <input type="text" value={form.label} maxLength={128}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  className="input-field" placeholder="Packs de Gold" />
              </Field>
              <Field label="Ordem">
                <input type="number" min={0} value={form.sort_order}
                  onChange={e => setForm(f => ({ ...f, sort_order: Number(e.target.value) }))}
                  className="input-field" />
              </Field>
              {error && <div className="px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{error}</div>}
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-700">
              <button onClick={() => setModal(null)} className="btn-ghost">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {confirm !== null && (
        <ConfirmModal
          title={confirm.hard ? "Deletar Categoria?" : "Desativar Categoria?"}
          message={<>A categoria <span className="text-white font-medium">{categories.find(c => c.id === confirm.id)?.label}</span> será {confirm.hard ? 'apagada permanentemente.' : 'marcada como inativa.'}</>}
          confirmLabel={confirm.hard ? "Deletar Permanente" : "Desativar"}
          onConfirm={() => handleDelete(confirm.id, confirm.hard)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
