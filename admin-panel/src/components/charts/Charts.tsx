'use client';

import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts';
import { formatBRL, formatHour } from '@/utils/formatters';

// ── Palette ───────────────────────────────────────────────────────────────────
const INDIGO  = '#6366f1';
const INDIGO2 = '#818cf8';

interface TooltipProps { active?: boolean; payload?: { value: number; name?: string }[]; label?: string; }

const CustomTooltip = ({ active, payload, label }: TooltipProps) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#1c2035', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10 }}
      className="px-3 py-2 text-xs shadow-xl">
      <p style={{ color: '#5b6080' }} className="mb-1 font-medium">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: '#c7d2fe' }} className="font-semibold">{formatBRL(p.value)}</p>
      ))}
    </div>
  );
};

const axisStyle  = { fill: '#94a3b8', fontSize: 12, fontFamily: 'Inter, sans-serif' };
const gridStyle  = { stroke: 'rgba(255,255,255,0.08)', strokeDasharray: '3 3' };

// ─── Revenue Area Chart ───────────────────────────────────────────────────────
interface RevenuePoint { key: string; revenueCents: number; }
export function RevenueAreaChart({ data }: { data: RevenuePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={INDIGO}  stopOpacity={0.25} />
            <stop offset="95%" stopColor={INDIGO}  stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridStyle} />
        <XAxis dataKey="key"  tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={v => `R$${(v/100).toFixed(0)}`} tick={axisStyle} tickLine={false} axisLine={false} width={60} />
        <Tooltip content={<CustomTooltip />} />
        <Area type="monotone" dataKey="revenueCents" stroke={INDIGO2} strokeWidth={2.5} fillOpacity={1} fill="url(#revenueGrad)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Sales By Hour Line Chart ─────────────────────────────────────────────────
interface HourPoint { hour: number; count: number; revenueCents: number; }
export function SalesByHourChart({ data }: { data: HourPoint[] }) {
  const formatted = data.map(d => ({ ...d, label: formatHour(d.hour) }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={formatted} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridStyle} />
        <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} interval={3} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={36} />
        <Tooltip content={<CustomTooltip />} />
        <Line type="monotone" dataKey="revenueCents" stroke={INDIGO} strokeWidth={3} dot={{ r: 3, fill: INDIGO2, strokeWidth: 0 }} activeDot={{ r: 5, fill: '#fff' }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Weekday Bar Chart ────────────────────────────────────────────────────────
interface WeekdayPoint { name: string; revenueCents: number; count: number; }
export function WeekdayBarChart({ data }: { data: WeekdayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridStyle} vertical={false} />
        <XAxis dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={v => `R$${(v/100).toFixed(0)}`} tick={axisStyle} tickLine={false} axisLine={false} width={60} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="revenueCents" fill="rgba(99,102,241,0.4)" stroke={INDIGO2} strokeWidth={1.5} radius={[4, 4, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Product Ranking Bar Chart ────────────────────────────────────────────────
interface ProductPoint { productId: string; revenueCents: number; count: number; }
export function ProductRankingChart({ data }: { data: ProductPoint[] }) {
  const top10 = data.slice(0, 10);
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={top10} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 108 }}>
        <CartesianGrid {...gridStyle} horizontal={false} />
        <XAxis type="number" tickFormatter={v => `R$${(v/100).toFixed(0)}`} tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="productId" tick={{ ...axisStyle, textAnchor: 'end' }} width={120} tickLine={false} axisLine={false} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="revenueCents" fill="rgba(99,102,241,0.3)" stroke={INDIGO2} strokeWidth={1.5} radius={[0, 4, 4, 0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  );
}
