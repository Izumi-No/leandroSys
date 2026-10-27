import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import type { Role } from '@leandrosys/shared';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

type Props = { children: ReactNode; papéis?: readonly Role[] };

/** Exige sessão ativa e, opcionalmente, papéis específicos. */
export function RequireAuth({ children, papéis }: Props) {
  const { user, carregando } = useAuth();
  const local = useLocation();

  if (!user) {
    if (carregando) {
      return (
        <div className="flex min-h-svh flex-col gap-4 p-6">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      );
    }
    return <Navigate to="/login" replace state={{ origem: local.pathname }} />;
  }

  if (papéis && !papéis.includes(user.role)) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          A área <strong>{papéis.join(' / ')}</strong> não está liberada para o seu papel (
          {user.username}).
        </p>
        <a href="/" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Voltar ao salão
        </a>
      </main>
    );
  }

  return <>{children}</>;
}
