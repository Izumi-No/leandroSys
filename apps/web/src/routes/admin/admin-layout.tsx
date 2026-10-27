import { cn } from '@/lib/utils';
import {
  ClipboardList,
  Monitor,
  Printer,
  Route,
  Rows3,
  Users,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';

const SECOES = [
  { to: '/admin/mesas', rotulo: 'Mesas', icone: Rows3 },
  { to: '/admin/catalogo', rotulo: 'Cardápio', icone: ClipboardList },
  { to: '/admin/impressoras', rotulo: 'Impressoras', icone: Printer },
  { to: '/admin/rotas', rotulo: 'Rotas', icone: Route },
  { to: '/admin/fila', rotulo: 'Fila', icone: Monitor },
  { to: '/admin/usuarios', rotulo: 'Usuários', icone: Users },
];

/** Shell da área administrativa: subnavegação + conteúdo da seção ativa. */
export function AdminLayout() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Administração</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Cadastros, impressão e usuários do sistema.
        </p>
      </header>

      <nav aria-label="Seções da administração" className="overflow-x-auto">
        <div className="flex min-w-max gap-1 rounded-lg bg-secondary p-1">
          {SECOES.map((secao) => {
            const Icone = secao.icone;
            return (
              <NavLink
                key={secao.to}
                to={secao.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                <Icone className="size-4" aria-hidden="true" />
                {secao.rotulo}
              </NavLink>
            );
          })}
        </div>
      </nav>

      <Outlet />
    </div>
  );
}
