'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/services/api';
import { formatBRL } from '@/utils/formatters';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CouponAnalytics {
  coupon: {
    code: string; description: string;
    discount_percent: number; max_uses: number | null;
    uses_count: number; active: boolean; expires_at: string | null;
    referrer_name: string | null; referrer_id: string | null;
    referrer_commission_percent: number | null;
    product_rule: string; product_ids: string[];
  };
  kpis: {
    uses: number;
    revenue_cents: number;
    discount_cents: number;
    commission_cents: number;
  };
  daily: { day: string; uses: number; revenue: number }[];
  history: {
    charge_id: string; player_identifier: string; product_id: string;
    original_amount_cents: number; discount_amount_cents: number;
    final_amount_cents: number; commission_cents: number | null;
    created_at: string;
  }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Mini bar chart
// ─────────────────────────────────────────────────────────────────────────────

function MiniBarChart({ data }: { data: { day: string; uses: number; revenue: number }[] }) {
  if (!data.length) return <div className="py-8 text-center text-sm text-slate-600">Sem dados ainda</div>;
  const maxRev = Math.max(...data.map(d => d.revenue), 1);
  return (
    <div className="flex items-end gap-1 h-28 w-full overflow-x-auto pb-1">
      {data.map(d => (
        <div key={d.day} className="flex flex-col items-center gap-1 flex-shrink-0" style={{ minWidth: 24 }}>
          <div
            className="w-full bg-brand-600/60 hover:bg-brand-500/80 rounded-t transition-colors cursor-default"
            style={{ height: `${Math.max((d.revenue / maxRev) * 96, 4)}px`, minWidth: 16 }}
            title={`${d.day}: ${d.uses} uso(s) · ${formatBRL(d.revenue)}`}
          />
          <span className="text-slate-700 text-[9px]">{d.day.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function CouponAnalyticsPage() {
  const { code } = useParams<{ code: string }>();
  const router   = useRouter();
  const [data,    setData]    = useState<CouponAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<CouponAnalytics>(`/v1/admin/coupons/${code}/analytics`);
      setData(res);
    } catch { /* api redirects on 401 */ }
    finally { setLoading(false); }
  }, [code]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!data) return (
    <div className="text-center py-16 text-slate-500">Cupom não encontrado.</div>
  );

  const { coupon, kpis, daily, history } = data;
  const expired = coupon.expires_at && new Date(coupon.expires_at) < new Date();
  const maxed   = coupon.max_uses !== null && coupon.uses_count >= coupon.max_uses;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/coupons')} className="text-slate-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-white font-mono">{coupon.code}</h1>
            {coupon.description && <p className="text-sm text-slate-400 mt-0.5">{coupon.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!coupon.active || expired
            ? <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-red-500/15 text-red-400">Inativo</span>
            : maxed
            ? <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-500/20 text-slate-400">Esgotado</span>
            : <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400">Ativo</span>}
          <span className="px-2.5 py-1 rounded-lg text-sm font-bold bg-brand-600/20 text-brand-300">{coupon.discount_percent}% off</span>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Total de Usos',        value: `${kpis.uses}${coupon.max_uses ? ` / ${coupon.max_uses}` : ''}`, color: 'text-white' },
          { label: 'Receita Gerada',        value: formatBRL(kpis.revenue_cents),    color: 'text-emerald-400' },
          { label: 'Desconto Concedido',   value: formatBRL(kpis.discount_cents),   color: 'text-orange-400' },
          { label: 'Comissão do Afiliado', value: formatBRL(kpis.commission_cents), color: 'text-purple-400' },
        ].map(k => (
          <div key={k.label} className="card p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide">{k.label}</p>
            <p className={`text-2xl font-bold mt-1 ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Info + chart row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Coupon info card */}
        <div className="card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white">Detalhes do Cupom</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Código</dt>
              <dd className="text-white font-mono">{coupon.code}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Desconto</dt>
              <dd className="text-emerald-400 font-semibold">{coupon.discount_percent}%</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Usos</dt>
              <dd className="text-white">{coupon.uses_count} {coupon.max_uses ? `/ ${coupon.max_uses}` : '(ilimitado)'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Produto</dt>
              <dd className="text-white capitalize">{coupon.product_rule}</dd>
            </div>
            {coupon.expires_at && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Expira</dt>
                <dd className={expired ? 'text-red-400' : 'text-white'}>
                  {new Date(coupon.expires_at).toLocaleDateString('pt-BR')}
                </dd>
              </div>
            )}
          </dl>

          {/* Affiliate */}
          {coupon.referrer_name && (
            <div className="pt-3 border-t border-slate-700/50 space-y-2">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Afiliado</p>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-300 text-sm font-bold">
                  {coupon.referrer_name[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{coupon.referrer_name}</p>
                  <p className="text-xs text-slate-500">{coupon.referrer_id}</p>
                </div>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Comissão</span>
                <span className="text-purple-400 font-semibold">{coupon.referrer_commission_percent}% da venda</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">A Pagar</span>
                <span className="text-purple-300 font-bold">{formatBRL(kpis.commission_cents)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Daily chart (last 30d) */}
        <div className="card p-5 xl:col-span-2">
          <h2 className="text-sm font-semibold text-white mb-4">Receita por Dia (últimos 30 dias)</h2>
          <MiniBarChart data={daily} />
        </div>
      </div>

      {/* Usage history */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/50">
          <h2 className="text-sm font-semibold text-white">Histórico de Uso</h2>
          <p className="text-xs text-slate-500 mt-0.5">{history.length} registro(s)</p>
        </div>
        {history.length === 0 ? (
          <div className="py-12 text-center text-slate-600 text-sm">Nenhum uso registrado ainda.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50">
                  {['Data', 'Jogador', 'Produto', 'Original', 'Desconto', 'Final', 'Comissão'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((row, i) => (
                  <tr key={i} className="border-b border-slate-700/30 hover:bg-surface-700/20">
                    <td className="px-4 py-2.5 text-slate-400 text-xs whitespace-nowrap">
                      {new Date(row.created_at).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-2.5 text-slate-300 font-mono text-xs">{row.player_identifier}</td>
                    <td className="px-4 py-2.5 text-slate-300">{row.product_id}</td>
                    <td className="px-4 py-2.5 text-slate-400">{formatBRL(row.original_amount_cents)}</td>
                    <td className="px-4 py-2.5 text-orange-400 font-medium">-{formatBRL(row.discount_amount_cents)}</td>
                    <td className="px-4 py-2.5 text-emerald-400 font-semibold">{formatBRL(row.final_amount_cents)}</td>
                    <td className="px-4 py-2.5 text-purple-400">
                      {row.commission_cents != null ? formatBRL(row.commission_cents) : <span className="text-slate-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
