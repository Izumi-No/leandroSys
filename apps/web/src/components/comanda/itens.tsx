import { StatusBadge } from '@/components/common/status-badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { api, ApiRequestError } from '@/lib/api';
import { brl, hora } from '@/lib/format';
import { ROTULO_ITEM, TOM_ITEM } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type { ComandaItemDTO } from '@leandrosys/shared';
import { Minus, Plus, Printer, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { mutate } from 'swr';

async function agir(caminho: string, metodo: 'PATCH' | 'DELETE' | 'POST', body?: unknown) {
  try {
    await api(caminho, { method: metodo, body });
    await mutate((chave) => typeof chave === 'string' && chave.startsWith('/comandas'));
  } catch (falha) {
    throw falha instanceof ApiRequestError ? falha : new Error('Erro inesperado');
  }
}

function Item({ item, comandaId, bloqueado }: { item: ComandaItemDTO; comandaId: string; bloqueado: boolean }) {
  const [erro, setErro] = useState<string | null>(null);
  const editavel = !bloqueado && !item.canceled;

  async function executar(operacao: () => Promise<unknown>) {
    setErro(null);
    try {
      await operacao();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Erro inesperado');
    }
  }

  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3',
        item.canceled && 'bg-muted/50 opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold">{item.quantity}x</span>
            <span className={cn('text-sm font-medium', item.canceled && 'line-through')}>
              {item.product.name}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {item.product.category} · {hora(item.createdAt)}
          </span>
          {item.aditionals.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              + {item.aditionals.map((a) => a.name).join(', ')}
            </span>
          ) : null}
          {item.note ? (
            <span className="text-xs text-accent-foreground">Obs.: {item.note}</span>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-1">
          <span className="font-mono text-sm font-semibold">{brl(item.total)}</span>
          <span className="text-xs text-muted-foreground">{brl(item.unitPrice)} un.</span>
          <StatusBadge rotulo={ROTULO_ITEM[item.status]} tom={TOM_ITEM[item.status]} />
        </div>
      </div>

      {erro ? <p className="text-xs text-destructive">{erro}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {editavel ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Diminuir quantidade"
              disabled={item.quantity <= 1 || item.status !== 'PENDING'}
              onClick={() =>
                void executar(() =>
                  agir(`/comandas/${comandaId}/items/${item.id}`, 'PATCH', {
                    quantity: item.quantity - 1,
                  }),
                )
              }
            >
              <Minus className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Aumentar quantidade"
              disabled={item.status !== 'PENDING'}
              onClick={() =>
                void executar(() =>
                  agir(`/comandas/${comandaId}/items/${item.id}`, 'PATCH', {
                    quantity: item.quantity + 1,
                  }),
                )
              }
            >
              <Plus className="size-4" />
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="text-destructive">
                  <Trash2 className="size-4" aria-hidden="true" />
                  {item.status === 'PENDING' ? 'Remover' : 'Cancelar'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {item.status === 'PENDING' ? 'Remover item?' : 'Cancelar item?'}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {item.status === 'PENDING'
                      ? 'O item ainda não foi impresso e será apagado da comanda.'
                      : 'O item já foi enviado: sai do total e da conta, mas permanece no histórico.'}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Voltar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      void executar(() => agir(`/comandas/${comandaId}/items/${item.id}`, 'DELETE'))
                    }
                  >
                    Confirmar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}

        {!item.canceled && item.status !== 'PENDING' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              void executar(() =>
                agir(`/comandas/${comandaId}/items/${item.id}/reprint`, 'POST', {}),
              )
            }
          >
            <Printer className="size-4" aria-hidden="true" />
            Reimprimir
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Lista de itens da comanda com edição (enquanto aberta) e reimpressão. */
export function ItensLista({
  comandaId,
  itens,
  bloqueado,
}: {
  comandaId: string;
  itens: ComandaItemDTO[];
  bloqueado: boolean;
}) {
  if (itens.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nenhum item lançado. Use o painel ao lado para adicionar.
      </div>
    );
  }

  const ordenados = [...itens].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <ul className="flex flex-col gap-3">
      {ordenados.map((item) => (
        <Item key={item.id} item={item} comandaId={comandaId} bloqueado={bloqueado} />
      ))}
    </ul>
  );
}
