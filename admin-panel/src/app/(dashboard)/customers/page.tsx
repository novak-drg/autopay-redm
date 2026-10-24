'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/services/api';
import { formatBRL } from '@/utils/formatters';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Player {
  id: number;
  player_identifier: string;
  email: string;
  cpf: string;
  full_name: string;
  registered_at: string;
  total_purchases: number;
  paid_purchases: number;
  total_spent_cents: number;
}

interface KPIs {
  total_players: number;
  players_with_purchase: number;
  total_revenue_cents: number;
  avg_ticket_cents: number;
}

interface TopBuyer {
  full_name: string;
  email: string;
  total_spent_cents: number;
  purchases: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const maskCpf = (cpf: string) => {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.***.**${d.slice(9)}`;
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const [players, setPlayers]   = useState<Player[]>([]);
  const [kpis, setKpis]         = useState<KPIs | null>(null);
  const [topBuyer, setTopBuyer] = useState<TopBuyer | null>(null);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [playersData, kpisData] = await Promise.all([
        api.get<{ players: Player[]; meta: { pages: number } }>(`/v1/admin/players?page=${page}&limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`),
        api.get<{ kpis: KPIs; topBuyer: TopBuyer | null }>('/v1/admin/players/kpis'),
      ]);
      setPlayers(playersData.players);
      setTotalPages(playersData.meta.pages || 1);
      setKpis(kpisData.kpis);
      setTopBuyer(kpisData.topBuyer);
    } catch { /* api redirects on 401 */ }
    finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { void load(); }, [load]);

  const kpiCards = kpis ? [
    { label: 'Total de Clientes',       value: String(kpis.total_players),             color: 'text-blue-400' },
    { label: 'Clientes com Compra',     value: String(kpis.players_with_purchase),     color: 'text-emerald-400' },
    { label: 'Receita Total',           value: formatBRL(kpis.total_revenue_cents),    color: 'text-green-400' },
    { label: 'Ticket Médio',            value: formatBRL(kpis.avg_ticket_cents || 0),  color: 'text-purple-400' },
  ] : [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-1 mb-2">
        <h1 className="text-2xl font-bold tracking-tight text-white">Clientes</h1>
        <p className="text-sm tracking-wide text-slate-400">Jogadores cadastrados para pagamentos PIX e analytics de compras</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        {kpiCards.map(k => (
          <div key={k.label} className="rounded-2xl p-6" style={{ background: '#131522', border: '1px solid rgba(255,255,255,0.04)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{k.label}</p>
            <p className={`text-2xl font-bold mt-1.5 ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Top Buyer */}
      {topBuyer && (
        <div className="rounded-2xl p-6 border-l-4 border-l-amber-500/60" style={{ background: '#131522', borderRight: '1px solid rgba(255,255,255,0.04)', borderTop: '1px solid rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.04)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">🏆 Top Comprador</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-white">{topBuyer.full_name}</p>
              <p className="text-xs font-medium text-slate-500 mt-0.5">{topBuyer.email}</p>
            </div>
            <div className="text-right">
              <p className="text-xl text-amber-500 font-bold">{formatBRL(topBuyer.total_spent_cents)}</p>
              <p className="text-xs font-medium text-slate-500">{topBuyer.purchases} compra{topBuyer.purchases !== 1 ? 's' : ''}</p>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
        </svg>
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Buscar por nome, e-mail ou identifier..."
          className="w-full pl-9 pr-4 py-3 bg-[#131522] border border-white/5 rounded-2xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 shadow-lg"
        />
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden mt-6" style={{ background: '#131522', border: '1px solid rgba(255,255,255,0.04)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
        <div className="flex items-center gap-2 p-6 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-500/10 border border-brand-500/20 text-brand-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
          </div>
          <h2 className="text-base font-semibold tracking-wide text-white">Lista de Clientes</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : players.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            {search ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#181a29]/80 border-b border-white/5">
                <tr>
                  {['Nome', 'E-mail', 'CPF', 'Identifier', 'Cadastrado em', 'Compras', 'Total Gasto'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-medium text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map(p => (
                  <tr key={p.id} className="border-b border-slate-700/30 hover:bg-surface-700/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-white">{p.full_name}</td>
                    <td className="px-4 py-3 text-slate-300">{p.email}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{maskCpf(p.cpf)}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs max-w-[160px] truncate" title={p.player_identifier}>{p.player_identifier}</td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{fmtDate(p.registered_at)}</td>
                    <td className="px-4 py-3">
                      <span className="text-white font-semibold">{p.paid_purchases}</span>
                      {p.total_purchases !== p.paid_purchases && (
                        <span className="text-slate-500 text-xs ml-1">({p.total_purchases} total)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-emerald-400 font-semibold">{formatBRL(p.total_spent_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm text-slate-400 bg-surface-700 rounded-lg disabled:opacity-40 hover:bg-surface-600 transition-colors"
          >← Anterior</button>
          <span className="text-sm text-slate-500">Página {page} de {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm text-slate-400 bg-surface-700 rounded-lg disabled:opacity-40 hover:bg-surface-600 transition-colors"
          >Próxima →</button>
        </div>
      )}
    </div>
  );
}
