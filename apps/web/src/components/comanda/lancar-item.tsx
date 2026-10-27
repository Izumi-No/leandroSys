import { Carregando, ErroAviso, Vazio } from '@/components/common/feedback';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { brl } from '@/lib/format';
import type { CategoriaDTO } from '@/lib/types';
import { Lock, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { ItemDialog } from './item-dialog';

type Produto = { id: string; name: string; price: string; categoryId: string };

/** Painel de lançamento: busca + categorias + grade de produtos. */
export function LancarItemPanel({ comandaId, bloqueado }: { comandaId: string; bloqueado: boolean }) {
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('todas');
  const [produto, setProduto] = useState<Produto | null>(null);

  const {
    data: categoriasData,
    error,
    isLoading,
  } = useSWR<{ categories: CategoriaDTO[] }>('/categories');
  const { data: adicionaisData } = useSWR<{ aditionals: { id: string; name: string; price: string }[] }>(
    '/aditionals',
  );

  const categorias = categoriasData?.categories ?? [];

  const todosProdutos = useMemo(
    () =>
      (categorias ?? []).flatMap((cat) =>
        cat.products.map((p) => ({ ...p, categoria: cat.name })),
      ),
    [categorias],
  );

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return todosProdutos.filter((p) => {
      const bateCategoria = categoria === 'todas' || p.categoryId === categoria;
      const bateBusca = !termo || p.name.toLowerCase().includes(termo);
      return bateCategoria && bateBusca;
    });
  }, [todosProdutos, categoria, busca]);

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Lançar item</CardTitle>
            <CardDescription>Escolha o produto para adicionar à comanda</CardDescription>
          </div>
          {bloqueado ? (
            <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
              <Lock className="size-3" aria-hidden="true" />
              Somente leitura
            </span>
          ) : null}
        </div>

        <div className="relative">
          <Search
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar produto…"
            className="pl-9"
            aria-label="Buscar produto"
          />
        </div>

        <div className="overflow-x-auto">
          <Tabs value={categoria} onValueChange={setCategoria}>
            <TabsList className="h-auto flex-nowrap">
              <TabsTrigger value="todas">Todas</TabsTrigger>
              {(categorias ?? []).map((cat) => (
                <TabsTrigger key={cat.id} value={cat.id}>
                  {cat.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {isLoading ? (
          <Carregando linhas={3} />
        ) : error ? (
          <ErroAviso erro={error} titulo="Cardápio indisponível" />
        ) : visiveis.length === 0 ? (
          <Vazio titulo="Nenhum produto encontrado" descricao="Ajuste a busca ou a categoria." />
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {visiveis.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={bloqueado}
                  onClick={() => setProduto({ id: p.id, name: p.name, price: p.price, categoryId: p.categoryId })}
                  className="flex h-full w-full flex-col items-start gap-1 rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-sm font-medium text-balance">{p.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{brl(p.price)}</span>
                  <span className="text-[11px] text-muted-foreground">{p.categoria}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <ItemDialog
        produto={produto}
        comandaId={comandaId}
        aditionals={adicionaisData?.aditionals ?? []}
        aoFechar={() => setProduto(null)}
      />
    </Card>
  );
}
