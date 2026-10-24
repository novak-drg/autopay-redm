'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/services/api';
import { KpiCard } from '@/components/analytics/KpiCard';
import { RevenueAreaChart, SalesByHourChart, WeekdayBarChart, ProductRankingChart } from '@/components/charts/Charts';
import { formatBRL, formatPct } from '@/utils/formatters';

interface Comparison {
  current:  { revenueCents: number; count: number; avgCents: number };
  previous: { revenueCents: number; count: number; avgCents: number };
  growth:   { revenuePct: number | null; countPct: number | null; avgPct: number | null };
}

function PeriodFilter({ from, to, onChange }: {
  from: string; to: string;
  onChange: (f: string, t: string) => void;
}) {
  const now     = new Date();
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

  const presets = [
    { label: 'Hoje',        f: fmtDate(now), t: fmtDate(now) },
    { label: '7 dias',      f: fmtDate(new Date(now.getTime() - 6*86400000)), t: fmtDate(now) },
    { label: 'Este mês',    f: fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), t: fmtDate(now) },
    { label: 'Mês passado', f: fmtDate(new Date(now.getFullYear(), now.getMonth()-1, 1)), t: fmtDate(new Date(now.getFullYear(), now.getMonth(), 0)) },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map(p => (
        <button
          key={p.label}
          onClick={() => onChange(p.f, p.t)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            from === p.f && to === p.t
              ? 'bg-brand-600 text-white'
              : 'bg-surface-700 text-slate-300 hover:bg-surface-600'
          }`}
        >
          {p.label}
        </button>
      ))}
      <input type="date" value={from} onChange={e => onChange(e.target.value, to)}
        className="input-field w-36 text-xs" />
      <span className="text-slate-500 text-xs">→</span>
      <input type="date" value={to} onChange={e => onChange(from, e.target.value)}
        className="input-field w-36 text-xs" />
    </div>
  );
}

export default function AnalyticsPage() {
  const now  = new Date();
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [to,   setTo]   = useState(now.toISOString().slice(0, 10));

  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [hourData,   setHourData]   = useState<{ hour: number; count: number; revenueCents: number }[]>([]);
  const [weekday,    setWeekday]    = useState<{ name: string; count: number; revenueCents: number }[]>([]);
  const [period,     setPeriod]     = useState<{ key: string; count: number; revenueCents: number }[]>([]);
  const [products,   setProducts]   = useState<{ productId: string; count: number; revenueCents: number }[]>([]);
  const [loading,    setLoading]    = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const q = `from=${from}&to=${to}`;
    try {
      const [cmp, hr, wd, pd, pr] = await Promise.all([
        api.get<Comparison>(`/v1/admin/analytics/comparison?${q}`),
        api.get<{ data: typeof hourData }>(`/v1/admin/analytics/sales-by-hour?${q}`),
        api.get<{ data: typeof weekday  }>(`/v1/admin/analytics/sales-by-weekday?${q}`),
        api.get<{ data: typeof period   }>(`/v1/admin/analytics/revenue-by-period?${q}&groupBy=day`),
        api.get<{ data: typeof products }>(`/v1/admin/analytics/product-ranking?${q}`),
      ]);
      setComparison(cmp);
      setHourData(hr.data);
      setWeekday(wd.data);
      setPeriod(pd.data);
      setProducts(pr.data);
    } catch { /* 401 → redirect handled */ }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const spin = (
    <div className="flex items-center justify-center h-48">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Analytics</h1>
          <p className="text-sm text-slate-400 mt-0.5">Análise detalhada de vendas e faturamento</p>
        </div>
        <PeriodFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      {/* Comparison KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          title="Receita no Período"
          value={formatBRL(comparison?.current.revenueCents ?? 0)}
          growth={comparison?.growth.revenuePct ?? null}
          color="green"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" /></svg>}
        />
        <KpiCard
          title="Transações Pagas"
          value={String(comparison?.current.count ?? 0)}
          growth={comparison?.growth.countPct ?? null}
          color="blue"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <KpiCard
          title="Ticket Médio"
          value={formatBRL(comparison?.current.avgCents ?? 0)}
          growth={comparison?.growth.avgPct ?? null}
          color="purple"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z"/></svg>}
        />
      </div>

      {/* Revenue by period */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Faturamento Diário</h2>
        {loading ? spin : <RevenueAreaChart data={period} />}
      </div>

      {/* Hour + Weekday */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Vendas por Hora do Dia</h2>
          {loading ? spin : <SalesByHourChart data={hourData} />}
        </div>
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Vendas por Dia da Semana</h2>
          {loading ? spin : <WeekdayBarChart data={weekday} />}
        </div>
      </div>

      {/* Product ranking */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Ranking de Produtos</h2>
        {loading ? spin : <ProductRankingChart data={products} />}
      </div>
    </div>
  );
}
