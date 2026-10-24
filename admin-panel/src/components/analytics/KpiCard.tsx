interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  growth?: number | null;
  icon: React.ReactNode;
  color?: 'blue' | 'green' | 'yellow' | 'purple';
}

const colorMap = {
  blue:   { bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.2)', text: '#60a5fa', glow: 'rgba(59,130,246,0.4)',  iconBg: 'linear-gradient(135deg, #2563eb, #3b82f6)' },
  green:  { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)', text: '#34d399', glow: 'rgba(16,185,129,0.4)', iconBg: 'linear-gradient(135deg, #059669, #10b981)' },
  yellow: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)', text: '#fbbf24', glow: 'rgba(245,158,11,0.4)', iconBg: 'linear-gradient(135deg, #d97706, #f59e0b)' },
  purple: { bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.2)', text: '#a78bfa', glow: 'rgba(139,92,246,0.4)', iconBg: 'linear-gradient(135deg, #7c3aed, #8b5cf6)' },
};

export function KpiCard({ title, value, subtitle, growth, icon, color = 'blue' }: KpiCardProps) {
  const growthPositive = growth !== null && growth !== undefined && growth >= 0;
  const growthText = growth !== null && growth !== undefined
    ? `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`
    : null;

  const style = colorMap[color];

  return (
    <div className="relative rounded-2xl p-6 overflow-hidden flex flex-col justify-between group"
      style={{
        background: '#131522',
        border: '1px solid rgba(255,255,255,0.04)',
        boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
        minHeight: '140px'
      }}>

      {/* Subtle background glow */}
      <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-[50px] opacity-30 group-hover:opacity-50 transition-opacity duration-500"
        style={{ background: style.glow }} />

      <div className="flex items-start justify-between relative z-10">
        <div className="flex flex-col gap-1.5 order-2">
          {/* Icon */}
          <div className="w-12 h-12 rounded-[14px] flex items-center justify-center text-white shadow-lg"
            style={{ background: style.iconBg, border: `1px solid ${style.border}` }}>
            {icon}
          </div>
        </div>

        <div className="order-1">
          <p className="text-sm font-semibold tracking-wide uppercase mb-1" style={{ color: '#94a3b8' }}>{title}</p>
          <p className="text-3xl font-bold tracking-tight text-white mb-1.5">{value}</p>

          <div className="flex items-center gap-2">
            {growthText && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-md flex items-center gap-0.5"
                style={growthPositive
                  ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80' }
                  : { background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
                {growthPositive ? '↑' : '↓'} {growthText}
              </span>
            )}
            {subtitle && <p className="text-xs" style={{ color: '#64748b' }}>{subtitle}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
