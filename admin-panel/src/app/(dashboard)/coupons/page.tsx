'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/services/api';
import { formatBRL } from '@/utils/formatters';
import CouponModal from './components/CouponModal';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Coupon {
  id: number;
  code: string;
  description: string;
  discount_percent: number;
  max_uses: number | null;
  uses_count: number;
  min_amount_cents: number | null;
  product_rule: 'all' | 'whitelist' | 'blacklist';
  product_ids: string[];
  referrer_id: string | null;
  referrer_name: string | null;
  referrer_commission_percent: number | null;
  active: boolean;
  expires_at: string | null;
  created_at: string;
  stats: {
    total_revenue_cents: number;
    total_discount_cents: number;
    total_commission_cents: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ coupon }: { coupon: Coupon }) {
  const expired = coupon.expires_at && new Date(coupon.expires_at) < new Date();
  const maxed   = coupon.max_uses !== null && coupon.uses_count >= coupon.max_uses;

  if (!coupon.active || expired)
    return <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-red-500/15 text-red-400">Inativo</span>;
  if (maxed)
    return <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-slate-500/20 text-slate-400">Esgotado</span>;
  return <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/15 text-emerald-400">Ativo</span>;
}

function RuleBadge({ rule }: { rule: string }) {
  const map: Record<string, [string, string]> = {
    all:       ['Todos', 'bg-blue-500/15 text-blue-400'],
    whitelist: ['Permitidos', 'bg-purple-500/15 text-purple-400'],
    blacklist: ['Bloqueados', 'bg-orange-500/15 text-orange-400'],
  };
  const [label, cls] = map[rule] ?? ['?', ''];
  return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function CouponsPage() {
  const router  = useRouter();
  const [coupons, setCoupons]       = useState<Coupon[]>([]);
  const [loading, setLoading]       = useState(true);
  const [modalOpen, setModalOpen]   = useState(false);
  const [editTarget, setEditTarget] = useState<Coupon | null>(null);
  const [deactivating, setDeact]    = useState<string | null>(null);
  const [search, setSearch]         = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ coupons: Coupon[] }>('/v1/admin/coupons');
      setCoupons(data.coupons);
    } catch { /* api redirects on 401 */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const deactivate = async (code: string) => {
    if (!confirm(`Desativar o cupom "${code}"?`)) return;
    setDeact(code);
    try { await api.delete(`/v1/admin/coupons/${code}`); await load(); }
    finally { setDeact(null); }
  };

  const hardDelete = async (code: string) => {
    if (!confirm(`Deletar o cupom "${code}" permanentemente? Essa ação não pode ser desfeita.`)) return;
    setDeact(code);
    try { await api.delete(`/v1/admin/coupons/${code}?hard=true`); await load(); }
    finally { setDeact(null); }
  };

  const openCreate = () => { setEditTarget(null); setModalOpen(true); };
  const openEdit   = (c: Coupon) => { setEditTarget(c); setModalOpen(true); };

  const filtered = coupons.filter(c =>
    c.code.includes(search.toUpperCase()) ||
    c.description.toLowerCase().includes(search.toLowerCase()) ||
    (c.referrer_name ?? '').toLowerCase().includes(search.toLowerCase())
  );

  // ── KPI totals ──
  const totalRevenue    = coupons.reduce((s, c) => s + c.stats.total_revenue_cents, 0);
  const totalDiscount   = coupons.reduce((s, c) => s + c.stats.total_discount_cents, 0);
  const totalCommission = coupons.reduce((s, c) => s + c.stats.total_commission_cents, 0);
  const totalUses       = coupons.reduce((s, c) => s + c.uses_count, 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1 mb-2">
          <h1 className="text-2xl font-bold tracking-tight text-white">Cupons</h1>
          <p className="text-sm tracking-wide text-slate-400">Gerencie descontos, afiliados e restrições de produtos</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Novo Cupom
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        {[
          { label: 'Receita com Desconto',  value: formatBRL(totalRevenue),    color: 'text-emerald-400' },
          { label: 'Desconto Concedido',    value: formatBRL(totalDiscount),   color: 'text-orange-400' },
          { label: 'Comissão a Pagar',      value: formatBRL(totalCommission), color: 'text-purple-400' },
          { label: 'Usos Totais',           value: String(totalUses),          color: 'text-blue-400' },
        ].map(k => (
          <div key={k.label} className="rounded-2xl p-6" style={{ background: '#131522', border: '1px solid rgba(255,255,255,0.04)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{k.label}</p>
            <p className={`text-2xl font-bold mt-1.5 ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
        </svg>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por código, descrição ou afiliado..."
          className="w-full pl-9 pr-4 py-3 bg-[#131522] border border-white/5 rounded-2xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 shadow-lg"
        />
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden mt-6" style={{ background: '#131522', border: '1px solid rgba(255,255,255,0.04)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
        <div className="flex items-center gap-2 p-6 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-500/10 border border-brand-500/20 text-brand-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" /></svg>
          </div>
          <h2 className="text-base font-semibold tracking-wide text-white">Cupons de Desconto</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            {search ? 'Nenhum cupom encontrado.' : 'Nenhum cupom criado ainda.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#181a29]/80 border-b border-white/5">
                <tr>
                  {['Código', 'Desconto', 'Usos', 'Receita', 'Desconto$', 'Comissão', 'Afiliado', 'Produtos', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-medium text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.code} className="border-b border-slate-700/30 hover:bg-surface-700/30 transition-colors">
                    {/* Code */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => router.push(`/coupons/${c.code}`)}
                        className="font-mono font-semibold text-brand-300 hover:text-brand-200 hover:underline"
                      >
                        {c.code}
                      </button>
                      {c.description && <p className="text-xs text-slate-500 mt-0.5 max-w-[160px] truncate">{c.description}</p>}
                    </td>

                    {/* Discount */}
                    <td className="px-4 py-3 text-emerald-400 font-semibold">{c.discount_percent}%</td>

                    {/* Uses */}
                    <td className="px-4 py-3 text-white">
                      {c.uses_count}
                      {c.max_uses !== null && <span className="text-slate-500">/{c.max_uses}</span>}
                    </td>

                    {/* Revenue */}
                    <td className="px-4 py-3 text-white">{formatBRL(c.stats.total_revenue_cents)}</td>

                    {/* Discount amount */}
                    <td className="px-4 py-3 text-orange-400">{formatBRL(c.stats.total_discount_cents)}</td>

                    {/* Commission */}
                    <td className="px-4 py-3 text-purple-400">
                      {c.referrer_commission_percent ? (
                        <span title={`${c.referrer_commission_percent}% = ${formatBRL(c.stats.total_commission_cents)}`}>
                          {formatBRL(c.stats.total_commission_cents)}
                        </span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>

                    {/* Referrer */}
                    <td className="px-4 py-3">
                      {c.referrer_name
                        ? <span className="text-slate-300">{c.referrer_name} <span className="text-xs text-slate-500">({c.referrer_commission_percent}%)</span></span>
                        : <span className="text-slate-600">—</span>}
                    </td>

                    {/* Product rule */}
                    <td className="px-4 py-3"><RuleBadge rule={c.product_rule} /></td>

                    {/* Status */}
                    <td className="px-4 py-3"><StatusBadge coupon={c} /></td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => router.push(`/coupons/${c.code}`)}
                          title="Analytics"
                          className="p-1.5 text-slate-500 hover:text-blue-400 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 13.5l5-5 4 4 5.5-6 3.5 3"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21H3"/></svg>
                        </button>
                        <button
                          onClick={() => openEdit(c)}
                          title="Editar"
                          className="p-1.5 text-slate-500 hover:text-white transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"/></svg>
                        </button>
                        <button
                          onClick={() => deactivate(c.code)}
                          disabled={deactivating === c.code}
                          title={c.active ? 'Desativar' : 'Manter inativo'}
                          className="p-1.5 text-slate-500 hover:text-orange-400 transition-colors disabled:opacity-50"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                        </button>
                        <button
                          onClick={() => hardDelete(c.code)}
                          disabled={deactivating === c.code}
                          title="Deletar permanentemente"
                          className="p-1.5 text-slate-500 hover:text-red-400 transition-colors disabled:opacity-50"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <CouponModal
          coupon={editTarget}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}
    </div>
  );
}
