'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type Currency = 'real_money' | 'diamond' | 'gold' | 'dollar';
type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
type RewardType = 'diamond' | 'gold' | 'rol' | 'item' | 'vip';

interface RewardEntry {
  _key: string;
  type: RewardType;
  amount?: number;
  item?: string;
  vip?: string;
}

interface BoxItem {
  id: number;
  itemId: string;
  itemName: string;
  rarity: Rarity;
  image: string;
  chancePct: number;
  locked: boolean;
  reward: Record<string, unknown>;
  sortOrder: number;
}

interface Box {
  id: string;
  name: string;
  description: string;
  currency: Currency;
  price: number;
  display_price: string;
  color: string;
  image: string;
  sort_order: number;
  active: number;
  items: BoxItem[];
}

interface BoxForm {
  id: string; name: string; description: string;
  currency: Currency; price: string; displayPrice: string;
  color: string; image: string; sortOrder: string;
}

interface ItemForm {
  rarity: Rarity;
  image: string; chancePct: string; locked: boolean;
  reward: RewardEntry[];
}

const BLANK_BOX: BoxForm = {
  id: '', name: '', description: '', currency: 'real_money',
  price: '', displayPrice: '', color: '#4dd0e1', image: '', sortOrder: '0',
};

const BLANK_ITEM: ItemForm = {
  rarity: 'common',
  image: '', chancePct: '0', locked: false, reward: [],
};

// Auto-gera um nome legível a partir da primeira recompensa
const deriveItemName = (rewards: RewardEntry[]): string => {
  if (!rewards.length) return 'Item';
  const r = rewards[0];
  if (r.type === 'diamond') return `${r.amount ?? 1} Diamantes`;
  if (r.type === 'gold') return `${r.amount ?? 1} Gold`;
  if (r.type === 'rol') return `R$ ${r.amount ?? 1}`;
  if (r.type === 'item') return r.item ? `Item: ${r.item}` : 'Item';
  if (r.type === 'vip') return r.vip ? `VIP: ${r.vip}` : 'VIP';
  return 'Item';
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CURRENCY_OPTIONS: { value: Currency; label: string }[] = [
  { value: 'real_money', label: 'Dinheiro Real (R$)' },
  { value: 'diamond', label: 'Diamantes' },
  { value: 'gold', label: 'Gold' },
  { value: 'dollar', label: 'Dólar' },
];

const RARITY_OPTIONS: { value: Rarity; label: string; color: string }[] = [
  { value: 'common', label: 'Comum', color: '#9e9e9e' },
  { value: 'uncommon', label: 'Incomum', color: '#4caf50' },
  { value: 'rare', label: 'Raro', color: '#2196f3' },
  { value: 'epic', label: 'Épico', color: '#9c27b0' },
  { value: 'legendary', label: 'Lendário', color: '#ff9800' },
];

const REWARD_TYPES: { value: RewardType; label: string; fields: string[] }[] = [
  { value: 'diamond', label: 'Diamantes', fields: ['amount'] },
  { value: 'gold', label: 'Gold', fields: ['amount'] },
  { value: 'rol', label: 'Dinheiro (Cash)', fields: ['amount'] },
  { value: 'item', label: 'Item', fields: ['item', 'amount'] },
  { value: 'vip', label: 'VIP', fields: ['vip'] },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel = 'Confirmar', onConfirm, onCancel }:
  { title: string; message: React.ReactNode; confirmLabel?: string; onConfirm: () => void; onCancel: () => void }) {
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

function RewardBuilder({ rewards, onChange }: { rewards: RewardEntry[]; onChange: (r: RewardEntry[]) => void }) {
  const add = () => onChange([...rewards, { _key: `key_${Date.now()}_${Math.random().toString(36).slice(2)}`, type: 'diamond', amount: 1 }]);
  const remove = (key: string) => onChange(rewards.filter(r => r._key !== key));
  const update = (key: string, patch: Partial<RewardEntry>) =>
    onChange(rewards.map(r => r._key === key ? { ...r, ...patch } : r));
  const changeType = (key: string, type: RewardType) => {
    const base: RewardEntry = { _key: key, type };
    if (['diamond', 'gold', 'rol'].includes(type)) base.amount = 1;
    if (type === 'item') { base.item = ''; base.amount = 1; }
    if (type === 'vip') base.vip = '';
    onChange(rewards.map(r => r._key === key ? base : r));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-400">Recompensa *</span>
        <button type="button" onClick={add}
          className="text-xs text-brand-400 hover:text-brand-300 font-medium flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Adicionar
        </button>
      </div>
      {rewards.length === 0 && (
        <div className="text-center py-3 border border-dashed border-slate-600 rounded-lg text-xs text-slate-500">
          Nenhuma recompensa. Clique em &quot;+ Adicionar&quot;.
        </div>
      )}
      {rewards.map(r => {
        const meta = REWARD_TYPES.find(t => t.value === r.type)!;
        return (
          <div key={r._key} className="bg-surface-700/50 border border-slate-700 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <select value={r.type} onChange={e => changeType(r._key, e.target.value as RewardType)}
                className="input-field text-sm flex-1">
                {REWARD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <button type="button" onClick={() => remove(r._key)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {meta.fields.includes('item') && <input type="text" placeholder="ID do item" value={r.item ?? ''} onChange={e => update(r._key, { item: e.target.value })} className="input-field text-sm" />}
            {meta.fields.includes('vip') && <input type="text" placeholder="ID do VIP" value={r.vip ?? ''} onChange={e => update(r._key, { vip: e.target.value })} className="input-field text-sm" />}
            {meta.fields.includes('amount') && (
              <input type="number" min={1} placeholder="Quantidade" value={r.amount ?? 1}
                onChange={e => update(r._key, { amount: Math.max(1, parseInt(e.target.value) || 1) })}
                className="input-field text-sm" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BoxesPage() {
  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col gap-1 mb-2">
        <h1 className="text-2xl font-bold tracking-tight text-white">Caixas</h1>
        <p className="text-sm tracking-wide text-slate-400">Gerencie caixas, itens e raridades</p>
      </div>
      <BoxesTab />
    </div>
  );
}

// ─── Boxes Tab ────────────────────────────────────────────────────────────────

function BoxesTab() {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'create' | 'edit' | 'items' | null>(null);
  const [form, setForm] = useState<BoxForm>(BLANK_BOX);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<{ id: string, hard: boolean } | null>(null);

  // Items panel
  const [selectedBox, setSelectedBox] = useState<Box | null>(null);
  const [itemModal, setItemModal] = useState<'add' | 'edit' | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm>(BLANK_ITEM);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [itemError, setItemError] = useState('');
  const [confirmItem, setConfirmItem] = useState<string | null>(null);

  const totalChance = (selectedBox?.items ?? []).reduce((s, i) => s + i.chancePct, 0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<{ boxes: Box[] }>('/v1/admin/boxes');
      setBoxes(d.boxes ?? []);
    } catch { /* handled */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh selectedBox when boxes list changes
  useEffect(() => {
    if (selectedBox) {
      const updated = boxes.find(b => b.id === selectedBox.id);
      if (updated) setSelectedBox(updated);
    }
  }, [boxes]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Box CRUD ──
  const openCreate = () => { setForm(BLANK_BOX); setEditId(null); setError(''); setModal('create'); };
  const openEdit = (b: Box) => {
    setForm({
      id: b.id, name: b.name, description: b.description, currency: b.currency as Currency,
      price: formatPriceByCurrency(b.price, b.currency),
      displayPrice: b.display_price, color: b.color, image: b.image,
      sortOrder: String(b.sort_order),
    });
    setEditId(b.id); setError(''); setModal('edit');
  };

  const handleSaveBox = async () => {
    setError('');
    if (modal === 'create' && !form.id) { setError('ID é obrigatório.'); return; }
    if (modal === 'create' && !/^[a-zA-Z0-9_-]{1,64}$/.test(form.id)) {
      setError('ID inválido. Use apenas letras, números, _ e -.'); return;
    }
    if (!form.name) { setError('Nome é obrigatório.'); return; }

    const payload = {
      id: form.id,
      name: form.name,
      description: form.description,
      currency: form.currency,
      price: parsePriceByCurrency(form.price, form.currency),
      displayPrice: form.displayPrice || (parsePriceByCurrency(form.price, form.currency) > 0
        ? (form.currency === 'diamond' || form.currency === 'gold'
            ? `${parsePriceByCurrency(form.price, form.currency)} ${form.currency === 'diamond' ? 'Diamantes' : 'Gold'}`
            : `R$ ${(parsePriceByCurrency(form.price, form.currency) / 100).toFixed(2).replace('.', ',')}`)
        : ''),
      color: form.color,
      image: form.image,
      sortOrder: parseInt(form.sortOrder) || 0,
    };

    setSaving(true);
    try {
      if (modal === 'create') {
        await api.post('/v1/admin/boxes', payload);
        // Recarrega a lista e abre o gerenciador de itens da caixa recem criada
        const d = await api.get<{ boxes: Box[] }>('/v1/admin/boxes');
        const newBoxes = d.boxes ?? [];
        setBoxes(newBoxes);
        const newBox = newBoxes.find(b => b.id === form.id);
        if (newBox) {
          setSelectedBox(newBox);
          setItemModal(null);
          setItemError('');
          setModal('items');
        } else {
          setModal(null);
        }
      } else {
        await api.put(`/v1/admin/boxes/${encodeURIComponent(editId!)}`, payload);
        setModal(null);
        await load();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao salvar.';
      if (msg.startsWith('validation_failed::')) {
        setError(`Erro de validação — ${msg.replace('validation_failed::', '')}`);
      } else if (msg === 'validation_failed') {
        setError('Dados inválidos. Verifique os campos preenchidos.');
      } else {
        setError(msg);
      }
    } finally { setSaving(false); }
  };

  const handleDeleteBox = async (id: string, hard: boolean) => {
    try { await api.delete(`/v1/admin/boxes/${encodeURIComponent(id)}${hard ? '?hard=true' : ''}`); setConfirm(null); await load(); }
    catch { /* handled */ }
  };

  // ── Items management ──
  const openItems = (b: Box) => { setSelectedBox(b); setItemModal(null); setItemError(''); setModal('items'); };

  const openAddItem = () => { setItemForm(BLANK_ITEM); setEditItemId(null); setItemError(''); setItemModal('add'); };
  const openEditItem = (it: BoxItem) => {
    const r = it.reward as { type?: RewardType; amount?: number; item?: string; vip?: string };
    const rewardEntries: RewardEntry[] = [{
      _key: `key_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type: (r.type ?? 'diamond') as RewardType,
      amount: r.amount,
      item: r.item,
      vip: r.vip,
    }];
    setItemForm({
      rarity: it.rarity as Rarity,
      image: it.image, chancePct: String(it.chancePct), locked: it.locked,
      reward: rewardEntries,
    });
    setEditItemId(it.itemId); setItemError(''); setItemModal('edit');
  };

  const buildRewardPayload = (rewards: RewardEntry[]) =>
    rewards.map(r => {
      const base: Record<string, unknown> = { type: r.type };
      if (['diamond', 'gold', 'rol'].includes(r.type)) base.amount = r.amount ?? 1;
      if (r.type === 'item') { base.item = r.item; base.amount = r.amount ?? 1; }
      if (r.type === 'vip') base.vip = r.vip;
      return base;
    });

  const handleSaveItem = async () => {
    if (!selectedBox) return;
    setItemError('');
    if (itemForm.reward.length === 0) { setItemError('Adicione ao menos 1 recompensa.'); return; }

    const pct = parseFloat(itemForm.chancePct) || 0;
    // Auto-gera itemId apenas no create; no edit usa o editItemId existente
    const autoId = itemModal === 'add'
      ? `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      : (editItemId ?? 'item_unknown');
    const autoName = deriveItemName(itemForm.reward);

    const payload = {
      itemId: autoId,
      itemName: autoName,
      rarity: itemForm.rarity,
      image: itemForm.image,
      chancePct: pct,
      locked: itemForm.locked || pct > 0,
      reward: buildRewardPayload(itemForm.reward)[0] ?? { type: 'diamond', amount: 1 },
      sortOrder: 0,
    };

    setSavingItem(true);
    try {
      if (itemModal === 'add') {
        await api.post(`/v1/admin/boxes/${encodeURIComponent(selectedBox.id)}/items`, payload);
      } else {
        await api.put(`/v1/admin/boxes/${encodeURIComponent(selectedBox.id)}/items/${encodeURIComponent(editItemId!)}`, payload);
      }
      setItemModal(null);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao salvar item.';
      if (msg.startsWith('validation_failed::')) {
        setItemError(`Erro de validação — ${msg.replace('validation_failed::', '')}`);
      } else if (msg === 'validation_failed') {
        setItemError('Dados inválidos. Verifique os campos preenchidos.');
      } else {
        setItemError(msg);
      }
    } finally { setSavingItem(false); }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!selectedBox) return;
    try {
      await api.delete(`/v1/admin/boxes/${encodeURIComponent(selectedBox.id)}/items/${encodeURIComponent(itemId)}`);
      setConfirmItem(null);
      await load();
    } catch { /* handled */ }
  };

  // ── Rarity colors ──
  const rarityColor = (r: string) => RARITY_OPTIONS.find(o => o.value === r)?.color ?? '#9e9e9e';
  const rarityLabel = (r: string) => RARITY_OPTIONS.find(o => o.value === r)?.label ?? r;

  return (
    <>
      <div className="flex justify-end">
        <button onClick={openCreate} className="btn-primary">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Nova Caixa
        </button>
      </div>

      {/* ── Box list ── */}
      <div className="rounded-2xl overflow-hidden mt-2" style={{ background: '#131522', border: '1px solid rgba(255,255,255,0.04)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
        <div className="flex items-center gap-2 p-6 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-500/10 border border-brand-500/20 text-brand-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" /></svg>
          </div>
          <h2 className="text-base font-semibold tracking-wide text-white">Lista de Caixas</h2>
        </div>
        {loading ? <LoadingSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#181a29]/80 border-b border-slate-700/50">
                <tr>{['ID', 'Nome', 'Moeda', 'Preço', 'Itens', 'Status', 'Ações'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {boxes.map(b => {
                  const currLabel = CURRENCY_OPTIONS.find(c => c.value === b.currency)?.label ?? b.currency;
                  const priceText = b.display_price || (b.price > 0 ? `R$ ${(b.price / 100).toFixed(2).replace('.', ',')}` : '—');
                  return (
                    <tr key={b.id} className="hover:bg-surface-700/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{b.id}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: b.color }} />
                          <p className="text-white font-medium">{b.name}</p>
                        </div>
                        <p className="text-slate-500 text-xs truncate max-w-[160px]">{b.description}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs">{currLabel}</td>
                      <td className="px-4 py-3 text-white font-medium">{priceText}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => openItems(b)}
                          className="text-xs text-brand-400 hover:text-brand-300 font-medium underline-offset-2 hover:underline">
                          {b.items?.length ?? 0} item(s)
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span className={b.active ? 'badge-green' : 'badge-red'}>{b.active ? 'Ativa' : 'Inativa'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(b)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-600">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                            </svg>
                          </button>
                          <button onClick={() => openItems(b)} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-400 hover:bg-brand-500/10">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                            </svg>
                          </button>
                          <button onClick={() => setConfirm({ id: b.id, hard: false })} className="p-1.5 rounded-lg text-slate-400 hover:text-orange-400 hover:bg-orange-500/10" title={b.active === 1 ? 'Desativar' : 'Manter inativo'}>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                          </button>
                          <button onClick={() => setConfirm({ id: b.id, hard: true })} className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10" title="Deletar permanentemente">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!boxes.length && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500 text-sm">Nenhuma caixa cadastrada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Box Create/Edit Modal ── */}
      {(modal === 'create' || modal === 'edit') && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-700 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-white">{modal === 'create' ? 'Nova Caixa' : `Editando: ${editId}`}</h2>
                <p className="text-xs text-slate-400 mt-0.5">Configure a caixa e depois adicione os itens</p>
              </div>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {modal === 'create' && (
                <Field label="ID da Caixa *">
                  <input type="text" value={form.id} maxLength={64}
                    onChange={e => setForm(f => ({ ...f, id: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '') }))}
                    className="input-field font-mono" placeholder="caixa_pirata" />
                  <p className="text-xs text-slate-500 mt-0.5">Letras, números, _ e - apenas</p>
                </Field>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Nome *">
                  <input type="text" value={form.name} maxLength={255}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="input-field" placeholder="Caixa Pirata" />
                </Field>
                <Field label="Cor de destaque">
                  <div className="flex gap-2">
                    <input type="color" value={form.color}
                      onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                      className="h-10 w-12 rounded cursor-pointer border-0 bg-transparent" />
                    <input type="text" value={form.color} maxLength={20}
                      onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                      className="input-field font-mono flex-1" />
                  </div>
                </Field>
              </div>

              <Field label="Descrição">
                <textarea value={form.description} maxLength={1000} rows={2}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="input-field resize-none" placeholder="Descrição da caixa..." />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Moeda de venda *">
                  <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value as Currency }))} className="input-field">
                    {CURRENCY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="Preço">
                  <input type="text" value={form.price} maxLength={12}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                    className="input-field" placeholder="29,90" />
                  <p className="text-xs text-slate-500 mt-0.5">Vírgula: 29,90 = R$29,90</p>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Texto exibido (opcional)">
                  <input type="text" value={form.displayPrice} maxLength={64}
                    onChange={e => setForm(f => ({ ...f, displayPrice: e.target.value }))}
                    className="input-field" placeholder="R$ 29,90" />
                </Field>
                <Field label="Imagem (path)">
                  <input type="text" value={form.image} maxLength={512}
                    onChange={e => setForm(f => ({ ...f, image: e.target.value }))}
                    className="input-field" placeholder="images/caixa_pirata.png" />
                </Field>
              </div>

              <Field label="Ordem de exibição">
                <input type="number" min={0} value={form.sortOrder}
                  onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))}
                  className="input-field" />
              </Field>

              {error && <div className="px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{error}</div>}
            </div>

            <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-700 flex-shrink-0">
              <button onClick={() => setModal(null)} className="btn-ghost">Cancelar</button>
              <button onClick={handleSaveBox} disabled={saving} className="btn-primary">
                {saving ? 'Salvando...' : modal === 'create' ? 'Criar e Adicionar Itens →' : 'Salvar Caixa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Items Manager Modal ── */}
      {modal === 'items' && selectedBox && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-700 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ background: selectedBox.color }} />
                  {selectedBox.name} — Itens
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Total chance: <span className={Math.abs(totalChance - 100) > 0.01 ? 'text-red-400 font-bold' : 'text-green-400 font-bold'}>
                    {totalChance.toFixed(2)}%
                  </span>
                  {Math.abs(totalChance - 100) > 0.01 && ' ⚠ deve somar 100%'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={openAddItem} className="btn-primary text-xs py-1.5">
                  + Adicionar Item
                </button>
                <button onClick={() => setModal(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            {/* Rarity Summary */}
            <div className="px-5 pt-4 flex gap-2 flex-wrap flex-shrink-0">
              {RARITY_OPTIONS.map(r => {
                const count = selectedBox.items.filter(i => i.rarity === r.value).length;
                const pct = selectedBox.items.filter(i => i.rarity === r.value).reduce((s, i) => s + i.chancePct, 0);
                return (
                  <div key={r.value} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700/50 border border-slate-700 text-xs">
                    <span className="w-2 h-2 rounded-full" style={{ background: r.color }} />
                    <span className="text-slate-300 font-medium">{r.label}</span>
                    <span className="text-slate-500">({count} itens • {pct.toFixed(1)}%)</span>
                  </div>
                );
              })}
            </div>

            {/* Items list */}
            <div className="overflow-y-auto flex-1 p-5">
              {selectedBox.items.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-sm">Nenhum item. Clique em &quot;+ Adicionar Item&quot;.</div>
              ) : (
                <div className="space-y-2">
                  {selectedBox.items.map(it => (
                    <div key={it.itemId} className="flex items-center gap-3 px-4 py-3 bg-surface-700/40 border border-slate-700/50 rounded-xl hover:bg-surface-700/70 transition-colors">
                      {/* Rarity indicator */}
                      <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: rarityColor(it.rarity) }} />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-white text-sm font-medium truncate">{it.itemName}</p>
                          <span className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
                            style={{ background: rarityColor(it.rarity) + '30', color: rarityColor(it.rarity) }}>
                            {rarityLabel(it.rarity)}
                          </span>
                          {it.locked && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 flex-shrink-0 flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                              fixo
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 font-mono">{it.itemId}</p>
                      </div>

                      {/* Chance bar */}
                      <div className="w-28 flex-shrink-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-slate-400">Chance</span>
                          <span className="text-xs font-bold text-white">{it.chancePct.toFixed(2)}%</span>
                        </div>
                        <div className="h-1.5 bg-surface-600 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(it.chancePct, 100)}%`, background: rarityColor(it.rarity) }} />
                        </div>
                      </div>

                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => openEditItem(it)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-600">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                          </svg>
                        </button>
                        <button onClick={() => setConfirmItem(it.itemId)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit Item Modal ── */}
      {itemModal && selectedBox && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-surface-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-700 flex-shrink-0">
              <h2 className="text-base font-semibold text-white">{itemModal === 'add' ? 'Adicionar Item' : 'Editar Item'}</h2>
              <button onClick={() => setItemModal(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4">

              <div className="grid grid-cols-2 gap-3">
                <Field label="Raridade *">
                  <select value={itemForm.rarity} onChange={e => setItemForm(f => ({ ...f, rarity: e.target.value as Rarity }))} className="input-field">
                    {RARITY_OPTIONS.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Imagem (path)">
                  <input type="text" value={itemForm.image} maxLength={512}
                    onChange={e => setItemForm(f => ({ ...f, image: e.target.value }))}
                    className="input-field" placeholder="items/espada.png" />
                </Field>
              </div>

              <div className="p-4 bg-surface-700/30 border border-slate-700 rounded-xl space-y-3">
                <p className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Chance de Drop</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <input type="range" min={0} max={100} step={0.5}
                      value={parseFloat(itemForm.chancePct) || 0}
                      onChange={e => setItemForm(f => ({ ...f, chancePct: e.target.value, locked: parseFloat(e.target.value) > 0 }))}
                      className="w-full accent-brand-500" />
                  </div>
                  <div className="w-24">
                    <input type="number" min={0} max={100} step={0.01}
                      value={itemForm.chancePct}
                      onChange={e => setItemForm(f => ({ ...f, chancePct: e.target.value, locked: parseFloat(e.target.value) > 0 }))}
                      className="input-field text-sm text-right" />
                  </div>
                  <span className="text-slate-400 text-sm font-medium">%</span>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="chk-locked" checked={itemForm.locked}
                    onChange={e => setItemForm(f => ({ ...f, locked: e.target.checked }))}
                    className="w-4 h-4 rounded accent-brand-500" />
                  <label htmlFor="chk-locked" className="text-xs text-slate-400 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Fixar percentual (não recalcular automaticamente)
                  </label>
                </div>
                <p className="text-xs text-slate-500">
                  Se deixar 0% e desligado, o percentual será distribuído automaticamente entre os itens não-fixados.
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-3">Recompensa ao Ganhar</p>
                <RewardBuilder rewards={itemForm.reward} onChange={r => setItemForm(f => ({ ...f, reward: r }))} />
              </div>

              {itemError && <div className="px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{itemError}</div>}
            </div>

            <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-700 flex-shrink-0">
              <button onClick={() => setItemModal(null)} className="btn-ghost">Cancelar</button>
              <button onClick={handleSaveItem} disabled={savingItem} className="btn-primary">
                {savingItem ? 'Salvando...' : 'Salvar Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm box deactivate/delete ── */}
      {confirm && (
        <ConfirmModal
          title={confirm.hard ? "Deletar Caixa?" : "Desativar caixa?"}
          message={<>A caixa <span className="text-white font-medium">{confirm.id}</span> será {confirm.hard ? 'apagada permanentemente.' : 'marcada como inativa.'}</>}
          confirmLabel={confirm.hard ? "Deletar Permanente" : "Desativar"}
          onConfirm={() => handleDeleteBox(confirm.id, confirm.hard)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* ── Confirm item delete ── */}
      {confirmItem && (
        <ConfirmModal
          title="Remover item?"
          message={<>O item <span className="text-white font-medium">{confirmItem}</span> será removido e os percentuais recalculados.</>}
          confirmLabel="Remover"
          onConfirm={() => handleDeleteItem(confirmItem)}
          onCancel={() => setConfirmItem(null)}
        />
      )}
    </>
  );
}
