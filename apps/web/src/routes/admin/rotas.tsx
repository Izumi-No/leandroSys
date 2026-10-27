import { ConfirmarExclusao } from '@/components/admin/confirmar';
import { FormDialog } from '@/components/admin/form-dialog';
import { Carregando, ErroAviso, PageHeader, Vazio } from '@/components/common/feedback';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
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
import type { CategoriaDTO, ProdutoDTO, RotaImpressaoDTO } from '@/lib/types';
import type { PrinterDTO } from '@leandrosys/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import useSWR, { mutate } from 'swr';

type Alvo = 'CATEGORY' | 'PRODUCT';

type Formulario = {
  escopo: Alvo;
  alvoId: string;
  printerId: string;
  priority: string;
};

const VAZIO: Formulario = { escopo: 'CATEGORY', alvoId: '', printerId: '', priority: '10' };

export function AdminRotasPage() {
  const { data: rotas, error, isLoading } = useSWR<{ routes: RotaImpressaoDTO[] }>('/print-routes');
  const { data: impressoras } = useSWR<{ printers: PrinterDTO[] }>('/printers');
  const { data: categoriasResposta } = useSWR<{ categories: CategoriaDTO[] }>('/categories');
  const { data: produtos } = useSWR<{ products: ProdutoDTO[] }>('/products?includeInactive=true');

  const [form, setForm] = useState<Formulario>(VAZIO);
  const [aberto, setAberto] = useState(false);

  const categorias = categoriasResposta?.categories ?? [];
  const listaRotas = rotas?.routes ?? [];
  const opcoesAlvo =
    form.escopo === 'CATEGORY'
      ? categorias.map((c) => ({ id: c.id, nome: c.name }))
      : (produtos?.products ?? []).map((p) => ({ id: p.id, nome: p.name }));

  function abrirCriacao() {
    setForm({
      ...VAZIO,
      printerId: impressoras?.printers[0]?.id ?? '',
      alvoId: '',
    });
    setAberto(true);
  }

  async function salvar() {
    const corpo =
      form.escopo === 'CATEGORY'
        ? { categoryId: form.alvoId, printerId: form.printerId, priority: Number(form.priority) }
        : { productId: form.alvoId, printerId: form.printerId, priority: Number(form.priority) };
    await api('/print-routes', { method: 'POST', body: corpo });
    await mutate('/print-routes');
  }

  async function excluir(rota: RotaImpressaoDTO) {
    await api(`/print-routes/${rota.id}`, { method: 'DELETE' });
    await mutate('/print-routes');
  }

  function impedirEnter(evento: KeyboardEvent) {
    if (evento.key === 'Enter') evento.preventDefault();
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        titulo="Rotas de impressão"
        descricao="Para onde cada item vai: rota por produto vence rota por categoria."
        acao={
          <Button
            size="sm"
            onClick={abrirCriacao}
            disabled={(impressoras?.printers.length ?? 0) === 0}
          >
            <Plus className="size-4" aria-hidden="true" />
            Nova rota
          </Button>
        }
      />

      {isLoading ? (
        <Carregando />
      ) : error ? (
        <ErroAviso erro={error} />
      ) : listaRotas.length === 0 ? (
        <Vazio
          titulo="Nenhuma rota configurada"
          descricao="Sem rota, os itens ficam pendentes e aparecem como 'unrouted' no envio."
        />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Alvo</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Impressora</TableHead>
                <TableHead className="w-28">Prioridade</TableHead>
                <TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listaRotas.map((rota) => (
                <TableRow key={rota.id}>
                  <TableCell>
                    <StatusBadge
                      rotulo={rota.target.scope === 'PRODUCT' ? 'Produto' : 'Categoria'}
                      tom={
                        rota.target.scope === 'PRODUCT'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-secondary-foreground'
                      }
                    />
                  </TableCell>
                  <TableCell className="font-medium">{rota.target.name}</TableCell>
                  <TableCell>{rota.printer.name}</TableCell>
                  <TableCell className="font-mono">{rota.priority}</TableCell>
                  <TableCell className="text-right">
                    <ConfirmarExclusao
                      gatilho={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Excluir rota ${rota.target.name}`}
                          className="text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      }
                      titulo="Excluir rota?"
                      descricao={`"${rota.target.name}" deixará de imprimir em "${rota.printer.name}".`}
                      aoConfirmar={() => excluir(rota)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FormDialog
        aberto={aberto}
        titulo="Nova rota"
        descricao="Escolha exatamente um alvo (produto ou categoria) e a impressora de destino."
        aoFechar={() => setAberto(false)}
        aoSubmeter={salvar}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="escopo-rota">Alvo</Label>
            <Select
              value={form.escopo}
              onValueChange={(valor) => setForm({ ...form, escopo: valor as Alvo, alvoId: '' })}
            >
              <SelectTrigger id="escopo-rota" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CATEGORY">Categoria</SelectItem>
                <SelectItem value="PRODUCT">Produto</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="alvo-rota">
              {form.escopo === 'CATEGORY' ? 'Categoria' : 'Produto'}
            </Label>
            <Select
              value={form.alvoId}
              onValueChange={(valor) => setForm({ ...form, alvoId: valor })}
            >
              <SelectTrigger id="alvo-rota" className="w-full">
                <SelectValue placeholder="Escolha…" />
              </SelectTrigger>
              <SelectContent>
                {opcoesAlvo.map((opcao) => (
                  <SelectItem key={opcao.id} value={opcao.id}>
                    {opcao.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="impressora-rota">Impressora</Label>
            <Select
              value={form.printerId}
              onValueChange={(valor) => setForm({ ...form, printerId: valor })}
            >
              <SelectTrigger id="impressora-rota" className="w-full">
                <SelectValue placeholder="Escolha…" />
              </SelectTrigger>
              <SelectContent>
                {impressoras?.printers.map((printer) => (
                  <SelectItem key={printer.id} value={printer.id}>
                    {printer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="prioridade-rota">Prioridade (0–99, maior primeiro)</Label>
            <Input
              id="prioridade-rota"
              type="number"
              min={0}
              max={99}
              value={form.priority}
              onKeyDown={impedirEnter}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            />
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
