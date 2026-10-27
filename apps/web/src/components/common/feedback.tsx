import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError } from '@/lib/api';
import { AlertCircle, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

export function PageHeader({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl">{titulo}</h1>
        {descricao ? (
          <p className="text-pretty text-sm text-muted-foreground">{descricao}</p>
        ) : null}
      </div>
      {acao ? <div className="flex flex-wrap items-center gap-2">{acao}</div> : null}
    </header>
  );
}

/** Mensagem de erro padronizada (usa o contrato `{ error, code, details }` da API). */
export function ErroAviso({ erro, titulo = 'Não foi possível carregar' }: { erro: unknown; titulo?: string }) {
  const mensagem =
    erro instanceof ApiRequestError ? erro.aviso : erro instanceof Error ? erro.message : 'Erro inesperado';

  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertTitle>{titulo}</AlertTitle>
      <AlertDescription>{mensagem}</AlertDescription>
    </Alert>
  );
}

export function Vazio({ titulo, descricao, acao }: { titulo: string; descricao?: string; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
      <Inbox className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="font-medium">{titulo}</p>
      {descricao ? <p className="text-sm text-muted-foreground text-pretty">{descricao}</p> : null}
      {acao}
    </div>
  );
}

export function Carregando({ linhas = 4 }: { linhas?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Carregando">
      <span className="sr-only">Carregando…</span>
      {Array.from({ length: linhas }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}
