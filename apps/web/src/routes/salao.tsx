import { Carregando, ErroAviso, PageHeader, Vazio } from '@/components/common/feedback';
import { MesaCard } from '@/components/salao/mesa-card';
import { LiberarDialog, TransferirDialog } from '@/components/salao/mesa-dialogos';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { TableDTO } from '@leandrosys/shared';
import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

type Filtro = 'todas' | 'livres' | 'ocupadas' | 'reservadas';

export function SalaoPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [mesaTransferir, setMesaTransferir] = useState<TableDTO | null>(null);
  const [mesaLiberar, setMesaLiberar] = useState<TableDTO | null>(null);
  const [avisoAcao, setAvisoAcao] = useState<string | null>(null);

  const { data, error, isLoading, isValidating, mutate } = useSWR<{ tables: TableDTO[] }>('/tables', {
    refreshInterval: 5000,
  });

  const operador = user ? ['ADMIN', 'WAITER', 'CASHIER'].includes(user.role) : false;
  const mesas = data?.tables ?? [];

  const contagem = useMemo(
    () => ({
      todas: mesas.length,
      livres: mesas.filter((mesa) => mesa.status === 'AVAILABLE').length,
      ocupadas: mesas.filter((mesa) => mesa.status === 'OCCUPIED').length,
      reservadas: mesas.filter((mesa) => mesa.status === 'RESERVED').length,
    }),
    [mesas],
  );

  const visiveis = useMemo(() => {
    if (filtro === 'todas') return mesas;
    const alvo = { livres: 'AVAILABLE', ocupadas: 'OCCUPIED', reservadas: 'RESERVED' }[filtro];
    return mesas.filter((mesa) => mesa.status === alvo);
  }, [mesas, filtro]);

  async function executar(acao: () => Promise<unknown>) {
    setAvisoAcao(null);
    try {
      await acao();
      await mutate();
    } catch (falha) {
      setAvisoAcao(falha instanceof ApiRequestError ? falha.aviso : 'Erro inesperado');
    }
  }

  async function ocupar(mesa: TableDTO) {
    await executar(async () => {
      const { comanda } = await api<{ comanda: { id: string } }>(`/tables/${mesa.id}/take`, {
        method: 'POST',
        body: user ? { waiterId: user.id } : {},
      });
      await mutate();
      navigate(`/comandas/${comanda.id}`);
    });
  }

  const reservar = (mesa: TableDTO) =>
    executar(() => api(`/tables/${mesa.id}/reserve`, { method: 'POST', body: {} }));

  const desreservar = (mesa: TableDTO) =>
    executar(() => api(`/tables/${mesa.id}/reserve`, { method: 'DELETE' }));

  const destinos = mesas.filter((mesa) => mesa.status === 'AVAILABLE' && mesa.id !== mesaTransferir?.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Salão"
        descricao="Mapa das mesas com comandas, tempos e ações do operador."
        acao={
          <Button variant="outline" size="sm" onClick={() => void mutate()} disabled={isValidating}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Atualizar
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ['Livres', contagem.livres],
            ['Ocupadas', contagem.ocupadas],
            ['Reservadas', contagem.reservadas],
            ['Total', contagem.todas],
          ] as const
        ).map(([rotulo, valor]) => (
          <div key={rotulo} className="rounded-xl border bg-card p-3">
            <p className="text-xs text-muted-foreground">{rotulo}</p>
            <p className="text-xl font-semibold tabular-nums">{valor}</p>
          </div>
        ))}
      </div>

      {avisoAcao ? <ErroAviso erro={new Error(avisoAcao)} titulo="Ação não concluída" /> : null}

      <Tabs value={filtro} onValueChange={(valor) => setFiltro(valor as Filtro)}>
        <TabsList>
          <TabsTrigger value="todas">Todas ({contagem.todas})</TabsTrigger>
          <TabsTrigger value="livres">Livres ({contagem.livres})</TabsTrigger>
          <TabsTrigger value="ocupadas">Ocupadas ({contagem.ocupadas})</TabsTrigger>
          <TabsTrigger value="reservadas">Reservadas ({contagem.reservadas})</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <Carregando linhas={8} />
        </div>
      ) : error ? (
        <ErroAviso erro={error} />
      ) : visiveis.length === 0 ? (
        <Vazio
          titulo="Nenhuma mesa neste filtro"
          descricao="Ajuste o filtro ou cadastre mesas na área de administração."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visiveis.map((mesa) => (
            <MesaCard
              key={mesa.id}
              mesa={mesa}
              operador={operador}
              onOcupar={(m) => void ocupar(m)}
              onReservar={(m) => void reservar(m)}
              onDesreservar={(m) => void desreservar(m)}
              onTransferir={setMesaTransferir}
              onLiberar={setMesaLiberar}
            />
          ))}
        </div>
      )}

      <TransferirDialog
        mesa={mesaTransferir}
        destinos={destinos}
        aoFechar={() => setMesaTransferir(null)}
      />
      <LiberarDialog mesa={mesaLiberar} aoFechar={() => setMesaLiberar(null)} />
    </div>
  );
}
