import { Carregando, ErroAviso, PageHeader } from '@/components/common/feedback';
import { StatusBadge } from '@/components/common/status-badge';
import { ComandaAcoes } from '@/components/comanda/acoes';
import { ItensLista } from '@/components/comanda/itens';
import { LancarItemPanel } from '@/components/comanda/lancar-item';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { brl, dataHora, plural } from '@/lib/format';
import { ROTULO_COMANDA, ROTULO_PAGAMENTO, TOM_COMANDA } from '@/lib/labels';
import type { ComandaDetailDTO } from '@leandrosys/shared';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import useSWR from 'swr';

export function ComandaDetalhePage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { data, error, isLoading } = useSWR<{ comanda: ComandaDetailDTO }>(
    id ? `/comandas/${id}` : null,
    { refreshInterval: 5000 },
  );

  const operador = user ? ['ADMIN', 'WAITER', 'CASHIER'].includes(user.role) : false;

  if (isLoading) return <Carregando linhas={6} />;
  if (error) return <ErroAviso erro={error} titulo="Comanda indisponível" />;
  if (!data) return null;

  const comanda = data.comanda;
  const bloqueado = comanda.status !== 'OPEN';
  const pendentes = comanda.items.filter((item) => item.status === 'PENDING' && !item.canceled).length;
  const ativos = comanda.items.filter((item) => !item.canceled);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo={`Comanda #${comanda.number}`}
        descricao={`Mesa ${comanda.table.number} · aberta em ${dataHora(comanda.openedAt)}`}
        acao={
          <>
            <StatusBadge
              rotulo={ROTULO_COMANDA[comanda.status]}
              tom={TOM_COMANDA[comanda.status]}
              className="text-sm"
            />
            <Button asChild variant="outline" size="sm">
              <Link to="/comandas">
                <ArrowLeft className="size-4" aria-hidden="true" />
                Comandas
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Itens</CardTitle>
              <span className="text-sm text-muted-foreground">
                {ativos.length} {plural(ativos.length, 'item', 'itens')}
                {pendentes > 0 ? ` · ${pendentes} pendente(s)` : ''}
              </span>
            </CardHeader>
            <CardContent>
              <ItensLista comandaId={comanda.id} itens={comanda.items} bloqueado={bloqueado} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total da comanda</span>
                <span className="font-mono text-xl font-semibold">{brl(comanda.total)}</span>
              </div>
              {comanda.paymentMethod ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Forma de pagamento</span>
                  <span>{ROTULO_PAGAMENTO[comanda.paymentMethod]}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Atendente</span>
                <span>{comanda.waiter ? comanda.waiter.username : 'sem atendente'}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {operador ? <ComandaAcoes comanda={comanda} /> : null}
          <LancarItemPanel comandaId={comanda.id} bloqueado={bloqueado || !operador} />
        </div>
      </div>
    </div>
  );
}
