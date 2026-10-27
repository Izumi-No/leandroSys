import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { brl, dataHora, minutosDesde, plural } from '@/lib/format';
import { ROTULO_COMANDA, ROTULO_MESA, TOM_MESA } from '@/lib/labels';
import { ArrowRightLeft, ClipboardList, Lock, Unlock } from 'lucide-react';
import type { TableDTO } from '@leandrosys/shared';
import { Link } from 'react-router-dom';

type Props = {
  mesa: TableDTO;
  operador: boolean;
  onTransferir: (mesa: TableDTO) => void;
  onLiberar: (mesa: TableDTO) => void;
  onOcupar: (mesa: TableDTO) => void;
  onReservar: (mesa: TableDTO) => void;
  onDesreservar: (mesa: TableDTO) => void;
};

/** Cartão de uma mesa do salão: estado, comanda aberta e ações do operador. */
export function MesaCard({
  mesa,
  operador,
  onTransferir,
  onLiberar,
  onOcupar,
  onReservar,
  onDesreservar,
}: Props) {
  const comanda = mesa.comanda;
  const ocupada = mesa.status === 'OCCUPIED';

  return (
    <article className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <h2 className="text-base font-semibold leading-tight">Mesa {mesa.number}</h2>
          {mesa.label ? <span className="text-xs text-muted-foreground">{mesa.label}</span> : null}
        </div>
        <StatusBadge rotulo={ROTULO_MESA[mesa.status]} tom={TOM_MESA[mesa.status]} />
      </header>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{mesa.capacity} lugares</span>
        {comanda ? (
          <>
            <span aria-hidden="true">·</span>
            <span>Comanda #{comanda.number}</span>
            <span aria-hidden="true">·</span>
            <span>{minutosDesde(comanda.openedAt)} min</span>
          </>
        ) : null}
      </div>

      {comanda ? (
        <div className="flex flex-col gap-2 rounded-lg bg-secondary/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <StatusBadge rotulo={ROTULO_COMANDA[comanda.status]} />
            <span className="font-mono text-sm font-semibold">{brl(comanda.total)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {comanda.waiter ? `Atendente: ${comanda.waiter.username}` : 'Sem atendente'} ·{' '}
            {comanda.itemCount} {plural(comanda.itemCount, 'item', 'itens')}
            {comanda.pendingItems > 0 ? ` · ${comanda.pendingItems} pendente(s)` : ''}
          </p>
          <p className="text-xs text-muted-foreground">Aberta em {dataHora(comanda.openedAt)}</p>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          {mesa.status === 'RESERVED' ? 'Mesa reservada, aguardando chegada.' : 'Sem comanda aberta.'}
        </p>
      )}

      <footer className="mt-auto flex flex-wrap gap-2">
        {ocupada && comanda ? (
          <Button asChild size="sm" className="flex-1">
            <Link to={`/comandas/${comanda.id}`}>
              <ClipboardList className="size-4" aria-hidden="true" />
              Abrir comanda
            </Link>
          </Button>
        ) : null}

        {operador ? (
          <>
            {mesa.status === 'AVAILABLE' ? (
              <>
                <Button size="sm" variant="default" className="flex-1" onClick={() => onOcupar(mesa)}>
                  Ocupar
                </Button>
                <Button size="sm" variant="outline" onClick={() => onReservar(mesa)}>
                  Reservar
                </Button>
              </>
            ) : null}

            {mesa.status === 'RESERVED' ? (
              <>
                <Button size="sm" className="flex-1" onClick={() => onOcupar(mesa)}>
                  <Unlock className="size-4" aria-hidden="true" />
                  Ocupar
                </Button>
                <Button size="sm" variant="outline" onClick={() => onDesreservar(mesa)}>
                  Cancelar reserva
                </Button>
              </>
            ) : null}

            {ocupada ? (
              <>
                <Button size="sm" variant="outline" onClick={() => onTransferir(mesa)}>
                  <ArrowRightLeft className="size-4" aria-hidden="true" />
                  Transferir
                </Button>
                <Button size="sm" variant="destructive" onClick={() => onLiberar(mesa)}>
                  <Lock className="size-4" aria-hidden="true" />
                  Liberar
                </Button>
              </>
            ) : null}
          </>
        ) : null}
      </footer>
    </article>
  );
}
