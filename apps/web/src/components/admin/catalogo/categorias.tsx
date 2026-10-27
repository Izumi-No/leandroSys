import { ConfirmarExclusao } from '@/components/admin/confirmar';
import { FormDialog } from '@/components/admin/form-dialog';
import { Carregando, ErroAviso, Vazio } from '@/components/common/feedback';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import type { CategoriaDTO } from '@/lib/types';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import useSWR, { mutate } from 'swr';

type Formulario = { id: string | null; name: string; active: boolean };

export function CategoriasPanel() {
  const { data, error, isLoading } = useSWR<{ categories: CategoriaDTO[] }>('/categories');
  const [form, setForm] = useState<Formulario>({ id: null, name: '', active: true });
  const [aberto, setAberto] = useState(false);

  const categorias = data?.categories ?? [];

  function abrirEdicao(categoria?: CategoriaDTO) {
    setForm(
      categoria ? { id: categoria.id, name: categoria.name, active: categoria.active } : { id: null, name: '', active: true },
    );
    setAberto(true);
  }

  async function salvar() {
    const corpo = { name: form.name.trim(), active: form.active };
    if (form.id) await api(`/categories/${form.id}`, { method: 'PATCH', body: corpo });
    else await api('/categories', { method: 'POST', body: corpo });
    await mutate('/categories');
  }

  async function excluir(categoria: CategoriaDTO) {
    await api(`/categories/${categoria.id}`, { method: 'DELETE' });
    await mutate('/categories');
  }

  function impedirEnter(evento: KeyboardEvent) {
    if (evento.key === 'Enter') evento.preventDefault();
  }

  if (isLoading) return <Carregando />;
  if (error) return <ErroAviso erro={error} />;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Categorias agrupam produtos no cardápio.</p>
        <Button size="sm" onClick={() => abrirEdicao()}>
          <Plus className="size-4" aria-hidden="true" />
          Nova categoria
        </Button>
      </div>

      {categorias.length === 0 ? (
        <Vazio titulo="Nenhuma categoria" descricao="Crie a primeira categoria do cardápio." />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="w-28">Produtos</TableHead>
                <TableHead className="w-28">Estado</TableHead>
                <TableHead className="w-40 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categorias.map((categoria) => (
                <TableRow key={categoria.id}>
                  <TableCell className="font-medium">{categoria.name}</TableCell>
                  <TableCell>{categoria.products.length}</TableCell>
                  <TableCell>
                    <StatusBadge rotulo={categoria.active ? 'Ativa' : 'Inativa'} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${categoria.name}`}
                        onClick={() => abrirEdicao(categoria)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <ConfirmarExclusao
                        gatilho={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Excluir ${categoria.name}`}
                            className="text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        }
                        titulo={`Excluir "${categoria.name}"?`}
                        descricao="Categorias com produtos vinculados não podem ser excluídas — desative-a ou remova os produtos antes."
                        aoConfirmar={() => excluir(categoria)}
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
        titulo={form.id ? 'Editar categoria' : 'Nova categoria'}
        aoFechar={() => setAberto(false)}
        aoSubmeter={salvar}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nome-categoria">Nome</Label>
            <Input
              id="nome-categoria"
              required
              maxLength={60}
              placeholder="Lanches"
              value={form.name}
              onKeyDown={impedirEnter}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              id="ativa-categoria"
              checked={form.active}
              onCheckedChange={(valor) => setForm({ ...form, active: valor === true })}
            />
            Categoria ativa no cardápio
          </label>
        </div>
      </FormDialog>
    </section>
  );
}
