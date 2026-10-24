'use client';

import { useState, useEffect } from 'react';
import { api } from '@/services/api';
import { KpiCard } from '@/components/analytics/KpiCard';
import { RevenueAreaChart, WeekdayBarChart, ProductRankingChart } from '@/components/charts/Charts';
import { formatBRL, formatPct } from '@/utils/formatters';

interface Overview {
  totalRevenueCents: number; paidCount: number; pendingCount: number;
  avgTicketCents: number; totalTransactions: number; revenueGrowthPct: number | null;
}
interface WeekdayData { name: string; revenueCents: number; count: number; }
interface PeriodData   { key: string;  revenueCents: number; count: number; }
interface ProductData  { productId: string; revenueCents: number; count: number; }

export default function DashboardPage() {
  const [overview,  setOverview]  = useState<Overview | null>(null);
  const [weekday,   setWeekday]   = useState<WeekdayData[]>([]);
  const [period,    setPeriod]    = useState<PeriodData[]>([]);
  const [products,  setProducts]  = useState<ProductData[]>([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [ov, wd, pd, pr] = await Promise.all([
          api.get<Overview>('/v1/admin/analytics/overview'),
          api.get<{ data: WeekdayData[] }>('/v1/admin/analytics/sales-by-weekday'),
          api.get<{ data: PeriodData[] }>('/v1/admin/analytics/revenue-by-period'),
          api.get<{ data: ProductData[] }>('/v1/admin/analytics/product-ranking'),
        ]);
        setOverview(ov);
        setWeekday(wd.data);
        setPeriod(pd.data);
        setProducts(pr.data);
      } catch { /* redirect handled by api service */ }
      finally { setLoading(false); }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Title */}
      <div className="flex flex-col gap-1 mb-2">
        <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard Geral</h1>
        <p className="text-sm tracking-wide text-slate-400">Desempenho, métricas e visão geral da loja</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          title="Receita Total"
          value={formatBRL(overview?.totalRevenueCents ?? 0)}
          growth={overview?.revenueGrowthPct ?? null}
          color="green"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <KpiCard
          title="Transações Pagas"
          value={String(overview?.paidCount ?? 0)}
          subtitle={`${overview?.pendingCount ?? 0} pendentes`}
          color="blue"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <KpiCard
          title="Ticket Médio"
          value={formatBRL(overview?.avgTicketCents ?? 0)}
          color="purple"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>}
        />
        <KpiCard
          title="Total de Cobranças"
          value={String(overview?.totalTransactions ?? 0)}
          color="yellow"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" /></svg>}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mt-4">
        <div className="rounded-2xl p-6" style={{ background: '#131522', border: '1px solid rgba(255,255,255,0.04)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-500/10 border border-brand-500/20 text-brand-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" /></svg>
            </div>
            <h2 className="text-base font-semibold tracking-wide text-white">Faturamento por Período</h2>
          </div>
          <RevenueAreaChart data={period} />
        </div>

        <div className="rounded-2xl p-6" style={{ background: '#131522', border: '1px solid rgba(255,255,255,0.04)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-500/10 border border-brand-500/20 text-brand-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" /></svg>
            </div>
            <h2 className="text-base font-semibold tracking-wide text-white">Vendas por Dia da Semana</h2>
          </div>
          <WeekdayBarChart data={weekday} />
        </div>
      </div>

      {/* Product ranking */}
      <div className="rounded-2xl p-6 mt-2" style={{ background: '#131522', border: '1px solid rgba(255,255,255,0.04)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-500/10 border border-brand-500/20 text-brand-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0" /></svg>
          </div>
          <h2 className="text-base font-semibold tracking-wide text-white">Ranking de Produtos (Top 10)</h2>
        </div>
        <ProductRankingChart data={products} />
      </div>
    </div>
  );
}
