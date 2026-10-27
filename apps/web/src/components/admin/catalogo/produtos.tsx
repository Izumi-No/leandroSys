import { ConfirmarExclusao } from '@/components/admin/confirmar';
import { FormDialog } from '@/components/admin/form-dialog';
import { Carregando, ErroAviso, Vazio } from '@/components/common/feedback';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { brl } from '@/lib/format';
import type { CategoriaDTO, ProdutoDTO } from '@/lib/types';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import useSWR, { mutate } from 'swr';

type Formulario = {
  id: string | null;
  name: string;
  price: string;
  categoryId: string;
  active: boolean;
};

const VAZIO: Formulario = { id: null, name: '', price: '', categoryId: '', active: true };

export function ProdutosPanel() {
  const { data, error, isLoading } = useSWR<{ products: ProdutoDTO[] }>(
    '/products?includeInactive=true',
  );
  const { data: categoriasResposta } = useSWR<{ categories: CategoriaDTO[] }>('/categories');
  const [form, setForm] = useState<Formulario>(VAZIO);
  const [aberto, setAberto] = useState(false);

  const produtos = data?.products ?? [];
  const listaCategorias = categoriasResposta?.categories ?? [];

  function abrirEdicao(produto?: ProdutoDTO) {
    setForm(
      produto
        ? {
            id: produto.id,
            name: produto.name,
            price: produto.price,
            categoryId: produto.category.id,
            active: produto.active,
          }
        : { ...VAZIO, categoryId: listaCategorias[0]?.id ?? '' },
    );
    setAberto(true);
  }

  async function salvar() {
    const corpo = {
      name: form.name.trim(),
      price: Number(form.price),
      categoryId: form.categoryId,
      active: form.active,
    };
    if (form.id) await api(`/products/${form.id}`, { method: 'PATCH', body: corpo });
    else await api('/products', { method: 'POST', body: corpo });
    await Promise.all([mutate('/products?includeInactive=true'), mutate('/categories')]);
  }

  async function excluir(produto: ProdutoDTO) {
    await api(`/products/${produto.id}`, { method: 'DELETE' });
    await Promise.all([mutate('/products?includeInactive=true'), mutate('/categories')]);
  }

  function impedirEnter(evento: KeyboardEvent) {
    if (evento.key === 'Enter') evento.preventDefault();
  }

  if (isLoading) return <Carregando />;
  if (error) return <ErroAviso erro={error} />;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Produtos com preço congelado no lançamento da comanda.
        </p>
        <Button size="sm" onClick={() => abrirEdicao()} disabled={listaCategorias.length === 0}>
          <Plus className="size-4" aria-hidden="true" />
          Novo produto
        </Button>
      </div>

      {listaCategorias.length === 0 ? (
        <Vazio titulo="Cadastre uma categoria antes" descricao="Produtos precisam de categoria." />
      ) : produtos.length === 0 ? (
        <Vazio titulo="Nenhum produto" descricao="Adicione itens ao cardápio." />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="w-32 text-right">Preço</TableHead>
                <TableHead className="w-28">Estado</TableHead>
                <TableHead className="w-40 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {produtos.map((produto) => (
                <TableRow key={produto.id}>
                  <TableCell className="font-medium">{produto.name}</TableCell>
                  <TableCell>{produto.category.name}</TableCell>
                  <TableCell className="text-right font-mono">{brl(produto.price)}</TableCell>
                  <TableCell>
                    <StatusBadge rotulo={produto.active ? 'Ativo' : 'Inativo'} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${produto.name}`}
                        onClick={() => abrirEdicao(produto)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <ConfirmarExclusao
                        gatilho={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Excluir ${produto.name}`}
                            className="text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        }
                        titulo={`Excluir "${produto.name}"?`}
                        descricao="Produtos com histórico em comandas não podem ser apagados — desative-o em vez disso."
                        aoConfirmar={() => excluir(produto)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FormDialog
        aberto={aberto}
        titulo={form.id ? 'Editar produto' : 'Novo produto'}
        aoFechar={() => setAberto(false)}
        aoSubmeter={salvar}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="nome-produto">Nome</Label>
            <Input
              id="nome-produto"
              required
              maxLength={80}
              placeholder="X-Burger"
              value={form.name}
              onKeyDown={impedirEnter}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="preco-produto">Preço (R$)</Label>
            <Input
              id="preco-produto"
              type="number"
              min={0}
              max={99999}
              step="0.01"
              required
              placeholder="24.90"
              value={form.price}
              onKeyDown={impedirEnter}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="categoria-produto">Categoria</Label>
            <Select
              value={form.categoryId}
              onValueChange={(valor) => setForm({ ...form, categoryId: valor })}
            >
              <SelectTrigger id="categoria-produto" className="w-full">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {listaCategorias.map((categoria) => (
                  <SelectItem key={categoria.id} value={categoria.id}>
                    {categoria.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              id="ativo-produto"
              checked={form.active}
              onCheckedChange={(valor) => setForm({ ...form, active: valor === true })}
            />
            Produto ativo no cardápio
          </label>
        </div>
      </FormDialog>
    </section>
  );
}
