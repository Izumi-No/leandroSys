import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ROTULO_PAPEL } from '@/lib/labels';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { ClipboardList, LayoutGrid, LogOut, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

type Link = { to: string; rotulo: string; icone: typeof LayoutGrid; exigeAdmin?: boolean };

const LINKS: Link[] = [
  { to: '/', rotulo: 'Salão', icone: LayoutGrid },
  { to: '/comandas', rotulo: 'Comandas', icone: ClipboardList },
  { to: '/admin', rotulo: 'Administração', icone: ShieldCheck, exigeAdmin: true },
];

function Item({ link, usuarioAdmin }: { link: Link; usuarioAdmin: boolean }) {
  if (link.exigeAdmin && !usuarioAdmin) return null;
  const Icone = link.icone;

  return (
    <NavLink
      to={link.to}
      end={link.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        )
      }
    >
      <Icone className="size-4 shrink-0" aria-hidden="true" />
      {link.rotulo}
    </NavLink>
  );
}

/** Layout comum: barra superior + navegação lateral (desktop) e em cima (mobile). */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, sair } = useAuth();
  const { pathname } = useLocation();
  const admin = user?.role === 'ADMIN';

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              l
            </span>
            <span className="text-sm font-semibold tracking-tight">leandroSys</span>
          </div>

          {user ? (
            <div className="flex items-center gap-3">
              <div className="hidden flex-col items-end sm:flex">
                <span className="text-sm font-medium leading-tight">{user.username}</span>
              </div>
              <Badge variant="secondary">{ROTULO_PAPEL[user.role]}</Badge>
              <Button variant="outline" size="sm" onClick={sair}>
                <LogOut className="size-4" aria-hidden="true" />
                Sair
              </Button>
            </div>
          ) : null}
        </div>

        <nav aria-label="Navegação principal" className="border-t">
          <div className="mx-auto flex w-full max-w-7xl gap-1 overflow-x-auto px-4 py-2">
            {LINKS.map((link) => (
              <Item key={link.to} link={link} usuarioAdmin={admin} />
            ))}
          </div>
        </nav>
      </header>

      <main key={pathname} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {children}
      </main>

      <footer className="border-t py-4">
        <p className="mx-auto w-full max-w-7xl px-4 text-xs text-muted-foreground">
          leandroSys — comandas, mesas e impressão ESC/POS
        </p>
      </footer>
    </div>
  );
}
