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
import { brl } from '@/lib/format';
import type { AdicionalDTO } from '@/lib/types';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import useSWR, { mutate } from 'swr';

type Formulario = { id: string | null; name: string; price: string; active: boolean };

const VAZIO: Formulario = { id: null, name: '', price: '0', active: true };
const CHAVE = '/aditionals?includeInactive=true';

export function AdicionaisPanel() {
  const { data, error, isLoading } = useSWR<{ aditionals: AdicionalDTO[] }>(CHAVE);
  const [form, setForm] = useState<Formulario>(VAZIO);
  const [aberto, setAberto] = useState(false);

  const aditionals = data?.aditionals ?? [];

  function abrirEdicao(adicional?: AdicionalDTO) {
    setForm(
      adicional
        ? { id: adicional.id, name: adicional.name, price: adicional.price, active: adicional.active }
        : VAZIO,
    );
    setAberto(true);
  }

  async function salvar() {
    const corpo = { name: form.name.trim(), price: Number(form.price), active: form.active };
    if (form.id) await api(`/aditionals/${form.id}`, { method: 'PATCH', body: corpo });
    else await api('/aditionals', { method: 'POST', body: corpo });
    await mutate(CHAVE);
  }

  async function excluir(adicional: AdicionalDTO) {
    await api(`/aditionals/${adicional.id}`, { method: 'DELETE' });
    await mutate(CHAVE);
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
          Adicionais são opcionais e somam ao preço do item.
        </p>
        <Button size="sm" onClick={() => abrirEdicao()}>
          <Plus className="size-4" aria-hidden="true" />
          Novo adicional
        </Button>
      </div>

      {aditionals.length === 0 ? (
        <Vazio titulo="Nenhum adicional" descricao="Ex.: borda recheada, ponto da carne." />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="w-32 text-right">Preço</TableHead>
                <TableHead className="w-28">Estado</TableHead>
                <TableHead className="w-40 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aditionals.map((adicional) => (
                <TableRow key={adicional.id}>
                  <TableCell className="font-medium">{adicional.name}</TableCell>
                  <TableCell className="text-right font-mono">{brl(adicional.price)}</TableCell>
                  <TableCell>
                    <StatusBadge rotulo={adicional.active ? 'Ativo' : 'Inativo'} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${adicional.name}`}
                        onClick={() => abrirEdicao(adicional)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <ConfirmarExclusao
                        gatilho={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Excluir ${adicional.name}`}
                            className="text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        }
                        titulo={`Excluir "${adicional.name}"?`}
                        descricao="O adicional será removido do cardápio. Lançamentos antigos mantêm o valor congelado."
                        aoConfirmar={() => excluir(adicional)}
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
        titulo={form.id ? 'Editar adicional' : 'Novo adicional'}
        aoFechar={() => setAberto(false)}
        aoSubmeter={salvar}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nome-adicional">Nome</Label>
            <Input
              id="nome-adicional"
              required
              maxLength={60}
              placeholder="Sem açúcar"
              value={form.name}
              onKeyDown={impedirEnter}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="preco-adicional">Preço (R$)</Label>
            <Input
              id="preco-adicional"
              type="number"
              min={0}
              max={99999}
              step="0.01"
              required
              value={form.price}
              onKeyDown={impedirEnter}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              id="ativo-adicional"
              checked={form.active}
              onCheckedChange={(valor) => setForm({ ...form, active: valor === true })}
            />
            Adicional ativo
          </label>
        </div>
      </FormDialog>
    </section>
  );
}
