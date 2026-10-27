import { Carregando, ErroAviso, PageHeader, Vazio } from '@/components/common/feedback';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { brl, dataHora, plural } from '@/lib/format';
import { ROTULO_COMANDA, ROTULO_PAGAMENTO, TOM_COMANDA } from '@/lib/labels';
import type { ComandaSummaryDTO } from '@leandrosys/shared';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

type Filtro = '' | 'OPEN' | 'PAYING' | 'CLOSED';

export function ComandasPage() {
  const [filtro, setFiltro] = useState<Filtro>('OPEN');
  const { data, error, isLoading, isValidating, mutate } = useSWR<{ comandas: ComandaSummaryDTO[] }>(
    filtro ? `/comandas?status=${filtro}` : '/comandas',
    { refreshInterval: 10_000 },
  );

  const comandas = data?.comandas ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Comandas"
        descricao="Todas as comandas do salão, com status, atendente e total."
        acao={
          <Button variant="outline" size="sm" onClick={() => void mutate()} disabled={isValidating}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Atualizar
          </Button>
        }
      />

      <Tabs value={filtro} onValueChange={(valor) => setFiltro(valor as Filtro)}>
        <TabsList>
          <TabsTrigger value="OPEN">Abertas</TabsTrigger>
          <TabsTrigger value="PAYING">Pagando</TabsTrigger>
          <TabsTrigger value="CLOSED">Fechadas</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <Carregando linhas={5} />
      ) : error ? (
        <ErroAviso erro={error} />
      ) : comandas.length === 0 ? (
        <Vazio
          titulo="Nenhuma comanda neste status"
          descricao="Ocupe uma mesa no salão para abrir uma comanda."
          acao={
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link to="/">Ir para o salão</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {comandas.map((comanda) => (
            <li key={comanda.id}>
              <Card className="py-4">
                <CardContent className="flex flex-col gap-3 px-4">
                  <header className="flex items-start justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="flex items-center gap-2">
                        <span className="font-semibold">Comanda #{comanda.number}</span>
                        <StatusBadge
                          rotulo={ROTULO_COMANDA[comanda.status]}
                          tom={TOM_COMANDA[comanda.status]}
                        />
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Mesa {comanda.table.number} · {dataHora(comanda.openedAt)}
                      </span>
                    </div>
                    <span className="font-mono text-base font-semibold">{brl(comanda.total)}</span>
                  </header>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">
                      {comanda.itemCount} {plural(comanda.itemCount, 'item', 'itens')}
                    </Badge>
                    {comanda.pendingItems > 0 ? (
                      <Badge variant="outline" className="border-accent text-accent-foreground">
                        {comanda.pendingItems} pendente(s)
                      </Badge>
                    ) : null}
                    <span>{comanda.waiter ? comanda.waiter.username : 'sem atendente'}</span>
                    {comanda.paymentMethod ? (
                      <span>· {ROTULO_PAGAMENTO[comanda.paymentMethod]}</span>
                    ) : null}
                  </div>

                  <Button asChild size="sm" variant="outline" className="self-end">
                    <Link to={`/comandas/${comanda.id}`}>
                      Abrir
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
