import { Carregando } from '@/components/common/feedback';
import { RequireAuth } from '@/components/common/require-auth';
import { AppShell } from '@/components/shell/app-shell';
import { ComandaDetalhePage } from '@/routes/comanda-detalhe';
import { ComandasPage } from '@/routes/comandas';
import { LoginPage } from '@/routes/login';
import { SalaoPage } from '@/routes/salao';
import { AdminLayout } from '@/routes/admin/admin-layout';
import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

/** Administração é a área maior e mais rara: carrega sob demanda. */
const AdminMesasPage = lazy(() =>
  import('@/routes/admin/mesas').then((m) => ({ default: m.AdminMesasPage })),
);
const AdminCatalogoPage = lazy(() =>
  import('@/routes/admin/catalogo').then((m) => ({ default: m.AdminCatalogoPage })),
);
const AdminImpressorasPage = lazy(() =>
  import('@/routes/admin/impressoras').then((m) => ({ default: m.AdminImpressorasPage })),
);
const AdminRotasPage = lazy(() =>
  import('@/routes/admin/rotas').then((m) => ({ default: m.AdminRotasPage })),
);
const AdminFilaPage = lazy(() =>
  import('@/routes/admin/fila').then((m) => ({ default: m.AdminFilaPage })),
);
const AdminUsuariosPage = lazy(() =>
  import('@/routes/admin/usuarios').then((m) => ({ default: m.AdminUsuariosPage })),
);

/** Envolvente padrão das rotas lazy do admin. */
const comSuspense = (elemento: ReactNode) => (
  <Suspense fallback={<Carregando linhas={5} />}>{elemento}</Suspense>
);

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell>
              <Outlet />
            </AppShell>
          </RequireAuth>
        }
      >
        <Route index element={<SalaoPage />} />
        <Route path="comandas" element={<ComandasPage />} />
        <Route path="comandas/:id" element={<ComandaDetalhePage />} />

        <Route
          path="admin"
          element={
            <RequireAuth papéis={['ADMIN']}>
              <AdminLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="mesas" replace />} />
          <Route path="mesas" element={comSuspense(<AdminMesasPage />)} />
          <Route path="catalogo" element={comSuspense(<AdminCatalogoPage />)} />
          <Route path="impressoras" element={comSuspense(<AdminImpressorasPage />)} />
          <Route path="rotas" element={comSuspense(<AdminRotasPage />)} />
          <Route path="fila" element={comSuspense(<AdminFilaPage />)} />
          <Route path="usuarios" element={comSuspense(<AdminUsuariosPage />)} />
          <Route path="*" element={<Navigate to="mesas" replace />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
