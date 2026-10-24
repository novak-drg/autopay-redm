import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AutoPay RedM Admin',
  description: 'Painel Administrativo — acesso restrito',
  robots: 'noindex, nofollow',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body>{children}</body>
    </html>
  );
}
