import { ConfirmarExclusao } from '@/components/admin/confirmar';
import { FormDialog } from '@/components/admin/form-dialog';
import { Carregando, ErroAviso, PageHeader, Vazio } from '@/components/common/feedback';
import { StatusBadge } from '@/components/common/status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { dataHora } from '@/lib/format';
import { ROTULO_JOB, ROTULO_TRANSPORTE, TOM_JOB } from '@/lib/labels';
import type { PrinterDTO, PrintJobKind, PrintJobStatus, PrinterTransport } from '@leandrosys/shared';
import { CircleCheck, Link2Off, Pencil, Plus, Printer, Trash2, Wallet } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import useSWR, { mutate } from 'swr';

type Formulario = {
  id: string | null;
  name: string;
  address: string;
  transport: PrinterTransport;
  columns: string;
  codepage: string;
  active: boolean;
  printsBill: boolean;
};

type JobFila = {
  id: string;
  kind: PrintJobKind;
  status: PrintJobStatus;
  attempts: number;
  createdAt: string;
  lastError: string | null;
};

const VAZIO: Formulario = {
  id: null,
  name: '',
  address: '',
  transport: 'BLUETOOTH',
  columns: '32',
  codepage: '19',
  active: true,
  printsBill: false,
};

const TRANSPORTES: PrinterTransport[] = ['BLUETOOTH', 'USB', 'NETWORK'];

export function AdminImpressorasPage() {
  const { data, error, isLoading } = useSWR<{ printers: PrinterDTO[] }>('/printers');
  const [form, setForm] = useState<Formulario>(VAZIO);
  const [aberto, setAberto] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);
  const [filaId, setFilaId] = useState<string | null>(null);

  const impressoras = data?.printers ?? [];

  function abrirEdicao(printer?: PrinterDTO) {
    setRecado(null);
    setForm(
      printer
        ? {
            id: printer.id,
            name: printer.name,
            address: printer.address,
            transport: printer.transport,
            columns: String(printer.columns),
            codepage: String(printer.codepage),
            active: printer.active,
            printsBill: printer.printsBill,
          }
        : VAZIO,
    );
    setAberto(true);
  }

  async function salvar() {
    const corpo = {
      name: form.name.trim(),
      address: form.address.trim(),
      transport: form.transport,
      columns: Number(form.columns),
      codepage: Number(form.codepage),
      active: form.active,
      ...(form.id ? { printsBill: form.printsBill } : {}),
    };
    if (form.id) await api(`/printers/${form.id}`, { method: 'PATCH', body: corpo });
    else await api('/printers', { method: 'POST', body: corpo });
    await mutate('/printers');
  }

  async function excluir(printer: PrinterDTO) {
    await api(`/printers/${printer.id}`, { method: 'DELETE' });
    await mutate('/printers');
  }

  async function teste(printer: PrinterDTO) {
    setRecado(null);
    try {
      await api(`/printers/${printer.id}/test`, { method: 'POST', body: {} });
      setRecado(`Cupom de teste enfileirado para "${printer.name}".`);
      await mutate('/printers');
    } catch (falha) {
      setRecado(falha instanceof Error ? falha.message : 'Erro inesperado');
    }
  }

  async function desatrelar(printer: PrinterDTO) {
    if (!printer.agentId) return;
    setRecado(null);
    try {
      await api(`/printers/${printer.id}/detach`, {
        method: 'POST',
        body: { agentId: printer.agentId },
      });
      setRecado(`Fila "${printer.name}" liberada.`);
      await mutate('/printers');
    } catch (falha) {
      setRecado(falha instanceof Error ? falha.message : 'Erro inesperado');
    }
  }

  function impedirEnter(evento: KeyboardEvent) {
    if (evento.key === 'Enter') evento.preventDefault();
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        titulo="Filas de impressão"
        descricao="Cadastre a fila aqui; o printd atrela um dispositivo local (Bluetooth, rede ou USB) a ela."
        acao={
          <Button size="sm" onClick={() => abrirEdicao()}>
            <Plus className="size-4" aria-hidden="true" />
            Nova fila
          </Button>
        }
      />

      {recado ? (
        <Alert>
          <CircleCheck className="size-4" />
          <AlertTitle>Impressão</AlertTitle>
          <AlertDescription>{recado}</AlertDescription>
        </Alert>
      ) : null}

      {isLoading ? (
        <Carregando />
      ) : error ? (
        <ErroAviso erro={error} />
      ) : impressoras.length === 0 ? (
        <Vazio titulo="Nenhuma fila" descricao="Cadastre ao menos uma fila de impressão (balcão, cozinha, bar)." />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Dispositivo</TableHead>
                <TableHead>Atrelada a</TableHead>
                <TableHead className="w-24">Colunas</TableHead>
                <TableHead className="w-24">Codepage</TableHead>
                <TableHead className="w-24">Fila</TableHead>
                <TableHead className="w-36">Estado</TableHead>
                <TableHead className="w-52 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {impressoras.map((printer) => (
                <TableRow key={printer.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {printer.name}
                      {printer.printsBill ? (
                        <StatusBadge rotulo="Conta" tom="bg-accent text-accent-foreground" />
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-col text-xs">
                      <span className="font-mono">{printer.address || '—'}</span>
                      <span className="text-muted-foreground">
                        {ROTULO_TRANSPORTE[printer.transport]}
                        {printer.baud ? ` · ${printer.baud} baud` : ''}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {printer.agentId ? (
                      <span className="flex flex-col text-xs">
                        <span className="font-medium">{printer.agentName ?? 'agente'}</span>
                        <span className="font-mono text-muted-foreground">
                          {printer.agentId.slice(0, 8)}…
                        </span>
                      </span>
                    ) : (
                      <StatusBadge rotulo="Livre" tom="bg-muted text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell>{printer.columns}</TableCell>
                  <TableCell>{printer.codepage}</TableCell>
                  <TableCell>
                    <StatusBadge
                      rotulo={`${printer.pendingJobs} na fila`}
                      tom={
                        printer.pendingJobs > 0
                          ? 'bg-accent text-accent-foreground'
                          : 'bg-muted text-muted-foreground'
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <StatusBadge rotulo={printer.active ? 'Ativa' : 'Inativa'} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${printer.name}`}
                        onClick={() => abrirEdicao(printer)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Ver fila de ${printer.name}`}
                        onClick={() => setFilaId(printer.id)}
                      >
                        <Wallet className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Imprimir teste em ${printer.name}`}
                        onClick={() => void teste(printer)}
                      >
                        <Printer className="size-4" />
                      </Button>
                      {printer.agentId ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Desatrelar ${printer.name}`}
                          onClick={() => void desatrelar(printer)}
                        >
                          <Link2Off className="size-4" />
                        </Button>
                      ) : null}
                      <ConfirmarExclusao
                        gatilho={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Excluir ${printer.name}`}
                            className="text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        }
                        titulo={`Excluir "${printer.name}"?`}
                        descricao="Se houver jobs pendentes ou em impressão, a exclusão será recusada pela API."
                        aoConfirmar={() => excluir(printer)}
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
        titulo={form.id ? `Editar ${form.name}` : 'Nova fila'}
        descricao="A fila é só o destino lógico. O printd preenche o endereço e o transporte quando atrelar um dispositivo local; você também pode informar manualmente."
        aoFechar={() => setAberto(false)}
        aoSubmeter={salvar}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nome-impressora">Nome</Label>
            <Input
              id="nome-impressora"
              required
              maxLength={40}
              placeholder="Cozinha"
              value={form.name}
              onKeyDown={impedirEnter}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="endereco-impressora">Endereço (opcional)</Label>
            <Input
              id="endereco-impressora"
              placeholder="preenchido pelo printd ao atrelar"
              value={form.address}
              onKeyDown={impedirEnter}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="transporte-impressora">Transporte</Label>
            <Select
              value={form.transport}
              onValueChange={(valor) => setForm({ ...form, transport: valor as PrinterTransport })}
            >
              <SelectTrigger id="transporte-impressora" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSPORTES.map((transporte) => (
                  <SelectItem key={transporte} value={transporte}>
                    {ROTULO_TRANSPORTE[transporte]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="colunas-impressora">Colunas</Label>
              <Input
                id="colunas-impressora"
                type="number"
                min={16}
                max={64}
                value={form.columns}
                onKeyDown={impedirEnter}
                onChange={(e) => setForm({ ...form, columns: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="codepage-impressora">Codepage</Label>
              <Input
                id="codepage-impressora"
                type="number"
                min={0}
                max={255}
                value={form.codepage}
                onKeyDown={impedirEnter}
                onChange={(e) => setForm({ ...form, codepage: e.target.value })}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              id="ativa-impressora"
              checked={form.active}
              onCheckedChange={(valor) => setForm({ ...form, active: valor === true })}
            />
            Impressora ativa
          </label>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              id="conta-impressora"
              checked={form.printsBill}
              onCheckedChange={(valor) => setForm({ ...form, printsBill: valor === true })}
            />
            Imprimir a conta (só uma por vez)
          </label>
        </div>
      </FormDialog>

      <FilaDialog impressoraId={filaId} aoFechar={() => setFilaId(null)} />
    </div>
  );
}

function FilaDialog({ impressoraId, aoFechar }: { impressoraId: string | null; aoFechar: () => void }) {
  const { data, error, isLoading } = useSWR<{ printer: PrinterDTO; jobs: JobFila[] }>(
    impressoraId ? `/printers/${impressoraId}/queue?limit=30` : null,
    { refreshInterval: impressoraId ? 5000 : 0 },
  );

  return (
    <Dialog open={!!impressoraId} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Fila — {data?.printer.name ?? 'Impressora'}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <Carregando linhas={4} />
        ) : error ? (
          <ErroAviso erro={error} />
        ) : (data?.jobs.length ?? 0) === 0 ? (
          <Vazio titulo="Fila vazia" descricao="Nenhum job recente para esta impressora." />
        ) : (
          <ul className="flex flex-col gap-2">
            {data?.jobs.map((job) => (
              <li key={job.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {job.kind} · {job.attempts} tentativa(s)
                  </span>
                  <span className="text-xs text-muted-foreground">{dataHora(job.createdAt)}</span>
                  {job.lastError ? (
                    <span className="text-xs text-destructive">{job.lastError}</span>
                  ) : null}
                </div>
                <StatusBadge rotulo={ROTULO_JOB[job.status] ?? job.status} tom={TOM_JOB[job.status]} />
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
