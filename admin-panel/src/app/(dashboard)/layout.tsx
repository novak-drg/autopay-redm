'use client';
import { Sidebar } from '@/components/layout/Sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen" style={{ background: '#0c0e1a' }}>
      <Sidebar />
      <div className="flex-1 ml-56 flex flex-col min-h-screen">
        <main className="flex-1 p-6 overflow-auto animate-fade-in">
          {children}
        </main>
        <footer className="px-6 py-2.5 text-xs" style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: '#2e3450' }}>
          AutoPay RedM Admin — todas as ações são auditadas
        </footer>
      </div>
    </div>
  );
}
