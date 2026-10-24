export const formatBRL = (cents: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(cents / 100);

export const formatPct = (value: number | null, decimals = 1): string => {
  if (value === null) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
};

export const formatDate = (value: string | Date): string =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(value));

export const formatDateTime = (value: string | Date): string =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));

export const formatHour = (hour: number): string =>
  `${String(hour).padStart(2, '0')}:00`;

export const growthColor = (pct: number | null): string => {
  if (pct === null) return 'text-slate-400';
  return pct >= 0 ? 'text-emerald-400' : 'text-red-400';
};

export const growthArrow = (pct: number | null): string => {
  if (pct === null) return '';
  return pct >= 0 ? '↑' : '↓';
};
