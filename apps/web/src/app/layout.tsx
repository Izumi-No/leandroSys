import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../styles.css';

export const metadata: Metadata = {
  title: {
    default: 'leandroSys — comandas e mesas',
    template: '%s | leandroSys',
  },
  description: 'Sistema de comandas, mesas e impressão ESC/POS para restaurantes e bares.',
  applicationName: 'leandroSys',
  icons: {
    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Crect width="32" height="32" rx="7" fill="%231e3a8a"/%3E%3Ctext x="16" y="23" font-family="system-ui,sans-serif" font-size="20" font-weight="700" fill="white" text-anchor="middle"%3El%3C/text%3E%3C/svg%3E',
  },
};

export const viewport: Viewport = {
  themeColor: '#1e3a8a',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
