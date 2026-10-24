'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/services/api';
import { formatBRL, formatDateTime } from '@/utils/formatters';

// ── Constants ──────────────────────────────────────────────────────────────────
const BG   = '#0f0f17';
const CARD = '#161624';
const CARD2= '#1c1c2e';
const BDR  = 'rgba(255,255,255,0.06)';
const T1   = '#f1f1f1';
const T2   = '#64748b';
const T3   = '#374151';

const STATUS_LABELS: Record<string, string> = {
  PAID: 'Pago', PENDING: 'Pendente', EXPIRED: 'Expirado',
  FAILED: 'Falhou', CANCELED: 'Cancelado', CREATED: 'Criado',
};
const STATUS_COLORS: Record<string, { bg: string; color: string; dot: string }> = {
  PAID:     { bg: 'rgba(16,185,129,0.12)', color: '#34d399', dot: '#10b981' },
  PENDING:  { bg: 'rgba(245,158,11,0.12)', color: '#fbbf24', dot: '#f59e0b' },
  CREATED:  { bg: 'rgba(255,255,255,0.07)', color: '#94a3b8', dot: '#475569' },
  EXPIRED:  { bg: 'rgba(100,116,139,0.1)', color: '#475569', dot: '#334155' },
  FAILED:   { bg: 'rgba(239,68,68,0.12)', color: '#f87171', dot: '#ef4444' },
  CANCELED: { bg: 'rgba(239,68,68,0.12)', color: '#f87171', dot: '#ef4444' },
};
const STATUSES = ['', 'PAID', 'PENDING', 'CREATED', 'EXPIRED', 'FAILED', 'CANCELED'];

interface Transaction {
  charge_id: string; player_identifier: string; product_id: string;
  amount_cents: number; currency: string; status: string;
  created_at: string; paid_at: string | null; expires_at: string;
}
interface Page { page: number; perPage: number; total: number; totalPages: number; data: Transaction[]; }

// ── StatusBadge ────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.EXPIRED;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold select-none"
      style={{ background: c.bg, color: c.color }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.dot }} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── Confirm Modal ──────────────────────────────────────────────────────────────
function ConfirmModal({ title, message, confirmLabel, danger = true, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}>
      <div className="rounded-2xl p-6 w-full max-w-sm space-y-4 animate-slide-up"
        style={{ background: CARD2, border: BDR, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        <div>
          <h3 className="text-base font-semibold" style={{ color: T1 }}>{title}</h3>
          <p className="text-sm mt-1.5" style={{ color: T2 }}>{message}</p>
        </div>
        <div className="flex gap-3 justify-end pt-1">
          <button onClick={onCancel} className="btn-ghost text-sm">Cancelar</button>
          <button onClick={onConfirm}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-all"
            style={danger
              ? { background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }
              : { background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)', color: '#fff', boxShadow: '0 2px 10px rgba(139,92,246,0.3)' }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function TransactionsPage() {
  const now = new Date();
  const [from,    setFrom]    = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [to,      setTo]      = useState(now.toISOString().slice(0, 10));
  const [status,  setStatus]  = useState('');
  const [search,  setSearch]  = useState('');
  const [page,    setPage]    = useState(1);
  const [result,  setResult]  = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete,  setConfirmDelete]  = useState<Transaction | null>(null);
  const [confirmApprove, setConfirmApprove] = useState<Transaction | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ from, to, page: String(page), perPage: '25' });
      if (status) q.set('status', status);
      setResult(await api.get<Page>(`/v1/admin/analytics/transactions?${q}`));
    } catch { /* handled */ }
    finally { setLoading(false); }
  }, [from, to, status, page]);

  useEffect(() => { setPage(1); }, [from, to, status]);
  useEffect(() => { load(); }, [load]);

  const handleApprove = async (tx: Transaction) => {
    setConfirmApprove(null); setActionLoading(tx.charge_id);
    try {
      await api.post(`/v1/admin/analytics/transactions/${encodeURIComponent(tx.charge_id)}/approve`, {});
      showToast('Transação aprovada com sucesso.');
      await load();
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      showToast(m === 'already_paid' ? 'Transação já estava paga.' : `Erro: ${m}`, false);
    } finally { setActionLoading(null); }
  };

  const handleDelete = async (tx: Transaction) => {
    setConfirmDelete(null); setActionLoading(tx.charge_id);
    try {
      await api.delete(`/v1/admin/analytics/transactions/${encodeURIComponent(tx.charge_id)}`);
      showToast('Transação removida.');
      await load();
    } catch (e) { showToast(`Erro: ${e instanceof Error ? e.message : '?'}`, false); }
    finally { setActionLoading(null); }
  };

  const filtered = (result?.data ?? []).filter(tx => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return tx.charge_id.toLowerCase().includes(s) || tx.player_identifier.toLowerCase().includes(s) || tx.product_id.toLowerCase().includes(s);
  });

  // Quick stats from current page
  const stats = STATUSES.slice(1).map(s => ({
    s, label: STATUS_LABELS[s], count: result?.data.filter(t => t.status === s).length ?? 0,
  })).filter(x => x.count > 0);

  return (
    <div className="space-y-5 max-w-7xl mx-auto animate-fade-in">

      {/* Toast */}
      {toast && (
        <div className="fixed top-5 right-5 z-[100] px-4 py-3 rounded-xl text-sm font-medium animate-slide-up"
          style={toast.ok
            ? { background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.25)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }
            : { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }
          }>{toast.ok ? '✓ ' : '✕ '}{toast.msg}</div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">Transações</h1>
          <p className="text-sm tracking-wide text-slate-400">Histórico de cobranças PIX</p>
        </div>
        {result && (
          <span className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: 'rgba(255,255,255,0.04)', color: T2 }}>
            {result.total.toLocaleString()} registro{result.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Status chips */}
      {stats.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stats.map(({ s, label, count }) => {
            const c = STATUS_COLORS[s] ?? STATUS_COLORS.EXPIRED;
            const active = status === s;
            return (
              <button key={s} onClick={() => setStatus(active ? '' : s)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{ background: active ? c.bg : 'rgba(255,255,255,0.04)', color: active ? c.color : T3, border: `1px solid ${active ? c.dot + '33' : BDR}` }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} />
                {label} — {count}
              </button>
            );
          })}
          {status && (
            <button onClick={() => setStatus('')}
              className="text-xs px-3 py-1.5 rounded-lg transition-all"
              style={{ color: T3, background: 'rgba(255,255,255,0.03)', border: BDR }}>
              ✕ Limpar
            </button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="rounded-2xl p-5 flex flex-wrap items-center gap-3 relative z-10"
        style={{ background: '#131522', border: '1px solid rgba(255,255,255,0.04)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field w-36 text-xs" />
        <span className="text-xs" style={{ color: T3 }}>→</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input-field w-36 text-xs" />
        <select value={status} onChange={e => setStatus(e.target.value)} className="input-field w-36 text-xs">
          {STATUSES.map(s => <option key={s} value={s}>{s ? STATUS_LABELS[s] : 'Todos status'}</option>)}
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: T3 }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z"/>
          </svg>
          <input type="text" placeholder="Buscar ID, jogador, produto..." value={search}
            onChange={e => setSearch(e.target.value)} className="input-field text-xs pl-8" />
        </div>
        <button onClick={load} className="btn-primary text-xs px-5">Filtrar</button>
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: '#131522', border: '1px solid rgba(255,255,255,0.04)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
        <div className="flex items-center gap-2 p-6 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-500/10 border border-brand-500/20 text-brand-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <h2 className="text-base font-semibold tracking-wide text-white">Lista de Transações</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: '#2e2e48', borderTopColor: '#8b5cf6' }} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  {['Charge ID', 'Jogador', 'Produto', 'Valor', 'Status', 'Criada em', 'Paga em', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest"
                      style={{ color: T3, background: 'rgba(0,0,0,0.2)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((tx, i) => (
                  <tr key={tx.charge_id} className="group transition-colors"
                    style={{ borderTop: i > 0 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                    <td className="px-4 py-3.5">
                      <span className="font-mono text-xs" style={{ color: '#374151' }} title={tx.charge_id}>
                        …{tx.charge_id.slice(-10)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-xs font-medium" style={{ color: T2 }}>{tx.player_identifier}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-xs font-semibold" style={{ color: '#94a3b8' }}>{tx.product_id}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-sm font-bold" style={{ color: T1 }}>{formatBRL(tx.amount_cents)}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={tx.status} />
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span className="text-xs" style={{ color: T3 }}>{formatDateTime(tx.created_at)}</span>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span className="text-xs" style={{ color: tx.paid_at ? T3 : '#1f2937' }}>
                        {tx.paid_at ? formatDateTime(tx.paid_at) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {tx.status !== 'PAID' && (
                          <button disabled={actionLoading === tx.charge_id}
                            onClick={() => setConfirmApprove(tx)} title="Aprovar"
                            className="p-1.5 rounded-lg transition-all"
                            style={{ color: '#34d399' }}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(16,185,129,0.12)'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
                            </svg>
                          </button>
                        )}
                        <button disabled={actionLoading === tx.charge_id}
                          onClick={() => setConfirmDelete(tx)} title="Deletar"
                          className="p-1.5 rounded-lg transition-all"
                          style={{ color: '#f87171' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.1)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                          {actionLoading === tx.charge_id
                            ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                            : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && !loading && (
                  <tr><td colSpan={8} className="px-4 py-16 text-center text-sm" style={{ color: T3 }}>Nenhuma transação encontrada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {result && result.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <span className="text-xs" style={{ color: T3 }}>Página {result.page} de {result.totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn-ghost text-xs disabled:opacity-25">← Anterior</button>
              <button onClick={() => setPage(p => Math.min(result.totalPages, p + 1))} disabled={page >= result.totalPages} className="btn-ghost text-xs disabled:opacity-25">Próxima →</button>
            </div>
          </div>
        )}
      </div>

      {confirmApprove && <ConfirmModal title="Aprovar transação?" message={`Marcar a cobrança de ${confirmApprove.player_identifier} (${formatBRL(confirmApprove.amount_cents)}) como PAGA. O jogador receberá os itens.`} confirmLabel="✓ Aprovar" danger={false} onConfirm={() => handleApprove(confirmApprove)} onCancel={() => setConfirmApprove(null)} />}
      {confirmDelete  && <ConfirmModal title="Deletar transação?" message={`Remover permanentemente a cobrança de ${confirmDelete.player_identifier}. Ação irreversível.`} confirmLabel="Deletar" danger onConfirm={() => handleDelete(confirmDelete)} onCancel={() => setConfirmDelete(null)} />}
    </div>
  );
}
