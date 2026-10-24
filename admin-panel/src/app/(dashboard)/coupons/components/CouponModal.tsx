'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/services/api';
import type { Coupon } from '../page';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Product { id: string; label: string; category: string; active: number; }

interface Props {
  coupon: Coupon | null;   // null = create mode
  onClose: () => void;
  onSaved: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// MultiProductSelect
// ─────────────────────────────────────────────────────────────────────────────

function MultiProductSelect({
  value, onChange, products,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  products: Product[];
}) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  };

  const filtered = products.filter(p =>
    p.label.toLowerCase().includes(search.toLowerCase()) ||
    p.id.toLowerCase().includes(search.toLowerCase())
  );

  // group by category
  const groups = filtered.reduce<Record<string, Product[]>>((acc, p) => {
    const cat = p.category || 'Sem categoria';
    (acc[cat] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-surface-900 border border-slate-700 rounded-lg text-sm text-left focus:outline-none focus:border-brand-500"
      >
        <span className={value.length ? 'text-white' : 'text-slate-500'}>
          {value.length === 0 ? 'Selecionar produtos...' : `${value.length} produto(s) selecionado(s)`}
        </span>
        <svg className={`w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {value.map(id => {
            const p = products.find(x => x.id === id);
            return (
              <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand-600/20 border border-brand-500/30 rounded text-xs text-brand-300">
                {p?.label ?? id}
                <button type="button" onClick={() => toggle(id)} className="hover:text-red-400">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-700">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filtrar produtos..."
              className="w-full px-3 py-1.5 bg-surface-900 rounded text-sm text-white placeholder-slate-500 focus:outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {Object.keys(groups).length === 0 ? (
              <p className="text-center py-4 text-sm text-slate-500">Nenhum produto encontrado</p>
            ) : Object.entries(groups).map(([cat, items]) => (
              <div key={cat}>
                <p className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide bg-surface-900/50">{cat}</p>
                {items.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-700 transition-colors text-left"
                  >
                    <span className={`w-4 h-4 flex-shrink-0 rounded border transition-colors flex items-center justify-center ${value.includes(p.id) ? 'bg-brand-600 border-brand-500' : 'border-slate-600'}`}>
                      {value.includes(p.id) && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
                    </span>
                    <span className="text-sm text-slate-300 truncate">{p.label}</span>
                    <span className="text-xs text-slate-600 ml-auto font-mono">{p.id}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="p-2 border-t border-slate-700 flex gap-2">
            <button type="button" onClick={() => onChange(products.map(p => p.id))} className="text-xs text-brand-400 hover:text-brand-300">Selecionar todos</button>
            <span className="text-slate-700">·</span>
            <button type="button" onClick={() => onChange([])} className="text-xs text-slate-500 hover:text-slate-300">Limpar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Form field helpers
// ─────────────────────────────────────────────────────────────────────────────

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-600">{hint}</p>}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 bg-surface-900 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500';

// ─────────────────────────────────────────────────────────────────────────────
// CouponModal
// ─────────────────────────────────────────────────────────────────────────────

export default function CouponModal({ coupon, onClose, onSaved }: Props) {
  const isEdit = !!coupon;

  const [products, setProducts] = useState<Product[]>([]);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  // Form state
  const [code,          setCode]    = useState(coupon?.code ?? '');
  const [desc,          setDesc]    = useState(coupon?.description ?? '');
  const [pct,           setPct]     = useState(String(coupon?.discount_percent ?? ''));
  const [maxUses,       setMaxUses] = useState(String(coupon?.max_uses ?? ''));
  const [minAmount,     setMinAmt]  = useState(coupon?.min_amount_cents ? String(coupon.min_amount_cents / 100) : '');
  const [expires,       setExpires] = useState(coupon?.expires_at ? coupon.expires_at.slice(0, 16) : '');
  const [active,        setActive]  = useState(coupon?.active ?? true);

  // Product rule
  const [productRule,   setRule]    = useState<'all' | 'whitelist' | 'blacklist'>(coupon?.product_rule ?? 'all');
  const [productIds,    setPids]    = useState<string[]>(coupon?.product_ids ?? []);

  // Referrer (affiliate)
  const [showAffiliate, setShowAff] = useState(!!(coupon?.referrer_id));
  const [refId,   setRefId]  = useState(coupon?.referrer_id ?? '');
  const [refName, setRefName] = useState(coupon?.referrer_name ?? '');
  const [refPct,  setRefPct] = useState(String(coupon?.referrer_commission_percent ?? ''));

  const loadProducts = useCallback(async () => {
    try {
      const data = await api.get<{ products: Product[] }>('/v1/admin/products');
      setProducts((data.products ?? []).filter(p => p.active));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    const pctNum = parseFloat(pct);
    if (!pct || isNaN(pctNum) || pctNum <= 0 || pctNum > 100) {
      setError('Desconto inválido (1–100).'); setSaving(false); return;
    }
    if (showAffiliate) {
      const cPct = parseFloat(refPct);
      if (!refId.trim()) { setError('ID do afiliado é obrigatório.'); setSaving(false); return; }
      if (!refPct || isNaN(cPct) || cPct <= 0 || cPct > 100) { setError('Comissão inválida (1–100).'); setSaving(false); return; }
    }

    const payload = {
      code:                        code.toUpperCase(),
      description:                 desc,
      discount_percent:            pctNum,
      max_uses:                    maxUses ? parseInt(maxUses) : null,
      min_amount_cents:            minAmount ? Math.round(parseFloat(minAmount) * 100) : null,
      product_rule:                productRule,
      product_ids:                 productRule !== 'all' ? productIds : [],
      referrer_id:                 showAffiliate ? refId.trim() || null : null,
      referrer_name:               showAffiliate ? refName.trim() || null : null,
      referrer_commission_percent: showAffiliate && refPct ? parseFloat(refPct) : null,
      expires_at:                  expires ? new Date(expires).toISOString() : null,
      active,
    };

    try {
      if (isEdit) {
        await api.put(`/v1/admin/coupons/${coupon.code}`, payload);
      } else {
        await api.post('/v1/admin/coupons', payload);
      }
      onSaved();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar.';
      const msgMap: Record<string, string> = {
        code_already_exists: 'Este código já existe.',
        validation: 'Dados inválidos, verifique os campos.',
        referrer_id_required_with_commission: 'ID do afiliado é obrigatório quando há comissão.',
      };
      setError(msgMap[msg] ?? msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-800 border border-slate-700/50 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
          <h2 className="text-base font-semibold text-white">
            {isEdit ? `Editar Cupom — ${coupon.code}` : 'Novo Cupom'}
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Código do Cupom *" hint="Apenas letras maiúsculas, números, _ e -">
              <input required value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="EX: WESTFOX10" className={inputCls} disabled={isEdit} pattern="[A-Z0-9_-]{2,50}" maxLength={50} />
            </Field>
            <Field label="Desconto (%) *">
              <input required type="number" step="0.01" min="0.01" max="100" value={pct} onChange={e => setPct(e.target.value)} placeholder="10" className={inputCls} />
            </Field>
          </div>

          <Field label="Descrição">
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Cupom de desconto para parceiros..." maxLength={255} className={inputCls} />
          </Field>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Máx. Usos" hint="Vazio = ilimitado">
              <input type="number" min="1" value={maxUses} onChange={e => setMaxUses(e.target.value)} placeholder="∞" className={inputCls} />
            </Field>
            <Field label="Valor Mín. (R$)" hint="Ex: 10 = R$10,00">
              <input type="number" step="0.01" min="0" value={minAmount} onChange={e => setMinAmt(e.target.value)} placeholder="0" className={inputCls} />
            </Field>
            <Field label="Expiração">
              <input type="datetime-local" value={expires} onChange={e => setExpires(e.target.value)} className={inputCls} />
            </Field>
          </div>

          {/* Product restriction */}
          <div className="space-y-3 p-4 bg-surface-900/50 rounded-lg border border-slate-700/30">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-white">Restrição de Produtos</p>
            </div>
            <div className="flex gap-2">
              {(['all', 'whitelist', 'blacklist'] as const).map(opt => {
                const labels = { all: 'Todos os produtos', whitelist: 'Somente estes', blacklist: 'Exceto estes' };
                return (
                  <button type="button" key={opt} onClick={() => setRule(opt)}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium border transition-colors ${productRule === opt ? 'bg-brand-600/20 border-brand-500/40 text-brand-300' : 'border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                    {labels[opt]}
                  </button>
                );
              })}
            </div>

            {productRule !== 'all' && (
              <div>
                <p className="text-xs text-slate-400 mb-2">
                  {productRule === 'whitelist' ? 'Cupom válido APENAS para estes produtos:' : 'Cupom BLOQUEADO para estes produtos:'}
                </p>
                <MultiProductSelect value={productIds} onChange={setPids} products={products} />
              </div>
            )}
          </div>

          {/* Affiliate section */}
          <div className="space-y-3 p-4 bg-surface-900/50 rounded-lg border border-slate-700/30">
            <button type="button" onClick={() => setShowAff(v => !v)}
              className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-white">Afiliado / Referral</p>
                <span className="text-xs text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded">Opcional</span>
              </div>
              <svg className={`w-4 h-4 text-slate-500 transition-transform ${showAffiliate ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showAffiliate && (
              <div className="space-y-3 pt-2 border-t border-slate-700/30">
                <p className="text-xs text-slate-500">Quando este cupom for usado, o afiliado receberá uma porcentagem do valor final da venda.</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nome do Afiliado">
                    <input value={refName} onChange={e => setRefName(e.target.value)} placeholder="João Silva" maxLength={120} className={inputCls} />
                  </Field>
                  <Field label="ID do Afiliado *" hint="Ex: steam:12345 ou discord:678">
                    <input value={refId} onChange={e => setRefId(e.target.value)} placeholder="player:12345" maxLength={120} className={inputCls} />
                  </Field>
                </div>
                <Field label="Comissão do Afiliado (%)" hint="% do valor cobrado (após desconto) que vai para o afiliado">
                  <input type="number" step="0.01" min="0.01" max="100" value={refPct} onChange={e => setRefPct(e.target.value)} placeholder="5" className={inputCls} />
                </Field>
                {refPct && pct && (
                  <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                    <p className="text-xs text-purple-300">
                      💡 Exemplo: compra de R$100 → desconto de {pct}% = R${(100 * parseFloat(pct) / 100).toFixed(2)} → valor final R${(100 - 100 * parseFloat(pct) / 100).toFixed(2)} → comissão do afiliado: <strong>R${((100 - 100 * parseFloat(pct) / 100) * parseFloat(refPct) / 100).toFixed(2)}</strong>
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Active toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div className={`relative w-10 h-5 rounded-full transition-colors ${active ? 'bg-brand-600' : 'bg-slate-700'}`}
              onClick={() => setActive(v => !v)}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-sm text-slate-300">{active ? 'Cupom ativo' : 'Cupom inativo'}</span>
          </label>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{error}</div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {saving ? 'Salvando...' : isEdit ? 'Salvar Alterações' : 'Criar Cupom'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
