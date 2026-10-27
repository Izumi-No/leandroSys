import { ConfirmarExclusao } from '@/components/admin/confirmar';
import { FormDialog } from '@/components/admin/form-dialog';
import { Carregando, ErroAviso, PageHeader, Vazio } from '@/components/common/feedback';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
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
import { ROTULO_MESA, TOM_MESA } from '@/lib/labels';
import type { TableDTO } from '@leandrosys/shared';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import useSWR, { mutate } from 'swr';

type Formulario = { id: string | null; number: string; capacity: string; label: string };

const VAZIO: Formulario = { id: null, number: '', capacity: '4', label: '' };

export function AdminMesasPage() {
  const { data, error, isLoading } = useSWR<{ tables: TableDTO[] }>('/tables');
  const [form, setForm] = useState<Formulario>(VAZIO);
  const [aberto, setAberto] = useState(false);

  const mesas = data?.tables ?? [];

  function abrirEdicao(mesa?: TableDTO) {
    setForm(
      mesa
        ? { id: mesa.id, number: String(mesa.number), capacity: String(mesa.capacity), label: mesa.label ?? '' }
        : VAZIO,
    );
    setAberto(true);
  }

  async function salvar() {
    const corpo = {
      number: Number(form.number),
      capacity: Number(form.capacity || 1),
      label: form.label.trim() || null,
    };
    if (form.id) {
      await api(`/tables/${form.id}`, { method: 'PATCH', body: corpo });
    } else {
      await api('/tables', { method: 'POST', body: corpo });
    }
    await mutate('/tables');
  }

  async function excluir(mesa: TableDTO) {
    await api(`/tables/${mesa.id}`, { method: 'DELETE' });
    await mutate('/tables');
  }

  function impedirEnter(evento: KeyboardEvent) {
    if (evento.key === 'Enter') evento.preventDefault();
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        titulo="Mesas"
        descricao="Cadastro de mesas do salão: número, capacidade e identificação."
        acao={
          <Button size="sm" onClick={() => abrirEdicao()}>
            <Plus className="size-4" aria-hidden="true" />
            Nova mesa
          </Button>
        }
      />

      {isLoading ? (
        <Carregando />
      ) : error ? (
        <ErroAviso erro={error} />
      ) : mesas.length === 0 ? (
        <Vazio titulo="Nenhuma mesa cadastrada" descricao="Crie a primeira mesa para montar o salão." />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Nº</TableHead>
                <TableHead>Identificação</TableHead>
                <TableHead className="w-24">Lugares</TableHead>
                <TableHead className="w-32">Estado</TableHead>
                <TableHead className="w-40 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mesas.map((mesa) => (
                <TableRow key={mesa.id}>
                  <TableCell className="font-mono font-medium">{mesa.number}</TableCell>
                  <TableCell>{mesa.label ?? '—'}</TableCell>
                  <TableCell>{mesa.capacity}</TableCell>
                  <TableCell>
                    <StatusBadge rotulo={ROTULO_MESA[mesa.status]} tom={TOM_MESA[mesa.status]} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar mesa ${mesa.number}`}
                        onClick={() => abrirEdicao(mesa)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <ConfirmarExclusao
                        gatilho={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Excluir mesa ${mesa.number}`}
                            className="text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        }
                        titulo={`Excluir mesa ${mesa.number}?`}
                        descricao="A mesa será removida do salão. Se tiver comanda em aberto, a exclusão será recusada."
                        aoConfirmar={() => excluir(mesa)}
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
        titulo={form.id ? `Editar mesa ${form.number}` : 'Nova mesa'}
        descricao="O número da mesa é único no salão."
        aoFechar={() => setAberto(false)}
        aoSubmeter={salvar}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="numero">Número</Label>
            <Input
              id="numero"
              type="number"
              min={1}
              required
              value={form.number}
              onKeyDown={impedirEnter}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="capacidade">Lugares</Label>
            <Input
              id="capacidade"
              type="number"
              min={1}
              required
              value={form.capacity}
              onKeyDown={impedirEnter}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="identificacao">Identificação</Label>
            <Input
              id="identificacao"
              placeholder="Varanda, mezanino…"
              value={form.label}
              onKeyDown={impedirEnter}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
