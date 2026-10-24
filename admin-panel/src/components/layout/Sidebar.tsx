'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { authService } from '@/services/auth';

const C = {
  bg:       '#0a0a12',
  border:   'rgba(255,255,255,0.05)',
  activeBg: 'rgba(139,92,246,0.12)',
  activeBar:'#8b5cf6',
  activeIcon:'#a78bfa',
  activeText:'#ddd6fe',
  idleIcon:  '#374151',
  idleText:  '#4b5563',
  mutedLabel:'#1f2937',
};

const NAV_ITEMS = [
  { href: '/',             label: 'Dashboard',  icon: <GridIcon /> },
  { href: '/analytics',   label: 'Analytics',   icon: <BarChartIcon /> },
  { href: '/transactions', label: 'Transações',  icon: <SwapIcon /> },
  { href: '/products',    label: 'Produtos',     icon: <BoxIcon /> },
  { href: '/boxes',       label: 'Caixas',       icon: <CubeIcon /> },
  { href: '/coupons',     label: 'Cupons',       icon: <TicketIcon /> },
  { href: '/customers',   label: 'Clientes',     icon: <UsersIcon /> },
];

const SECTIONS: Record<string, string> = {
  '/transactions': 'Gestão',
  '/customers':    'Usuários',
};

export function Sidebar() {
  const pathname = usePathname();
  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <aside className="fixed inset-y-0 left-0 w-56 flex flex-col z-20"
      style={{ background: C.bg, borderRight: `1px solid ${C.border}` }}>

      {/* Brand */}
      <div className="flex items-center gap-3 h-16 px-5" style={{ borderBottom: `1px solid ${C.border}` }}>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)', boxShadow: '0 2px 12px rgba(139,92,246,0.35)' }}>
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd"/>
          </svg>
        </div>
        <div>
          <p className="text-sm font-bold leading-tight" style={{ color: '#e2e8f0' }}>AutoPay RedM</p>
          <p className="text-[10px] leading-tight" style={{ color: '#1f2937' }}>Admin Panel</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-2.5 space-y-0.5">
        {NAV_ITEMS.map(item => {
          const section = SECTIONS[item.href];
          const active  = isActive(item.href);
          return (
            <div key={item.href}>
              {section && (
                <p className="text-[10px] font-semibold uppercase tracking-widest px-3 pt-5 pb-2"
                  style={{ color: C.mutedLabel }}>{section}</p>
              )}
              <Link href={item.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150 relative overflow-hidden"
                style={{ background: active ? C.activeBg : 'transparent' }}>
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                    style={{ background: C.activeBar }} />
                )}
                <span style={{ color: active ? C.activeIcon : C.idleIcon }}>{item.icon}</span>
                <span style={{ color: active ? C.activeText : C.idleText }}>{item.label}</span>
              </Link>
            </div>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="p-2.5" style={{ borderTop: `1px solid ${C.border}` }}>
        <button onClick={() => authService.logout()}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150"
          style={{ color: C.mutedLabel }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background='rgba(239,68,68,0.08)'; el.style.color='#f87171'; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background='transparent'; el.style.color=C.mutedLabel; }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"/>
          </svg>
          Sair
        </button>
      </div>
    </aside>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────
function GridIcon()     { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>; }
function BarChartIcon() { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5l5-5 4 4 5.5-6 3.5 3"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 21H3"/></svg>; }
function SwapIcon()     { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"/></svg>; }
function BoxIcon()      { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/></svg>; }
function CubeIcon()     { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/></svg>; }
function TicketIcon()   { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185z"/></svg>; }
function UsersIcon()    { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/></svg>; }
