import { Carregando, ErroAviso, PageHeader, Vazio } from '@/components/common/feedback';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
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
import { api, ApiRequestError } from '@/lib/api';
import { dataHora } from '@/lib/format';
import { ROTULO_JOB, ROTULO_TIPO_JOB, TOM_JOB } from '@/lib/labels';
import { PRINT_JOB_STATUSES, type PrintJobStatus, type PrinterDTO } from '@leandrosys/shared';
import { Ban, RefreshCw, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import useSWR, { mutate } from 'swr';

type Job = {
  id: string;
  printerId: string;
  comandaId: string | null;
  kind: 'ITEM' | 'BILL' | 'TEST';
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
};

const TODOS = 'todos';

export function AdminFilaPage() {
  const [impressora, setImpressora] = useState(TODOS);
  const [status, setStatus] = useState(TODOS);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const { data: impressoras } = useSWR<{ printers: PrinterDTO[] }>('/printers');
  const { data, error, isLoading, isValidating } = useSWR<{ jobs: Job[] }>(() => {
    const params = new URLSearchParams({ limit: '50' });
    if (impressora !== TODOS) params.set('printerId', impressora);
    if (status !== TODOS) params.set('status', status);
    return `/print-jobs?${params.toString()}`;
  }, { refreshInterval: 5000 });

  const jobs = data?.jobs ?? [];
  const nomeImpressora = (id: string) =>
    impressoras?.printers.find((printer) => printer.id === id)?.name ?? '—';

  async function acao(caminho: string) {
    setErroAcao(null);
    try {
      await api(caminho, { method: 'POST', body: {} });
      await mutate((chave) => typeof chave === 'string' && chave.startsWith('/print-jobs'));
    } catch (falha) {
      setErroAcao(falha instanceof ApiRequestError ? falha.aviso : 'Erro inesperado');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        titulo="Fila de impressão"
        descricao="Jobs ESC/POS: PENDING → PRINTING → DONE (ou FAILED após 3 tentativas)."
        acao={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void mutate((chave) => typeof chave === 'string' && chave.startsWith('/print-jobs'))}
            disabled={isValidating}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Atualizar
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="filtro-impressora" className="text-xs text-muted-foreground">
            Impressora
          </label>
          <Select value={impressora} onValueChange={setImpressora}>
            <SelectTrigger id="filtro-impressora" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas</SelectItem>
              {impressoras?.printers.map((printer) => (
                <SelectItem key={printer.id} value={printer.id}>
                  {printer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="filtro-status" className="text-xs text-muted-foreground">
            Status
          </label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="filtro-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              {PRINT_JOB_STATUSES.map((opcao) => (
                <SelectItem key={opcao} value={opcao}>
                  {ROTULO_JOB[opcao]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {erroAcao ? <p className="text-sm text-destructive">{erroAcao}</p> : null}

      {isLoading ? (
        <Carregando />
      ) : error ? (
        <ErroAviso erro={error} />
      ) : jobs.length === 0 ? (
        <Vazio titulo="Fila vazia" descricao="Nenhum job com os filtros escolhidos." />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Criado</TableHead>
                <TableHead className="w-24">Tipo</TableHead>
                <TableHead>Impressora</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-24">Tentativas</TableHead>
                <TableHead>Erro</TableHead>
                <TableHead className="w-32 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>{dataHora(job.createdAt)}</TableCell>
                  <TableCell>{ROTULO_TIPO_JOB[job.kind]}</TableCell>
                  <TableCell>{nomeImpressora(job.printerId)}</TableCell>
                  <TableCell>
                    <StatusBadge rotulo={ROTULO_JOB[job.status]} tom={TOM_JOB[job.status]} />
                  </TableCell>
                  <TableCell className="font-mono">{job.attempts}</TableCell>
                  <TableCell className="text-xs text-destructive">{job.lastError ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {job.status === 'FAILED' || job.status === 'CANCELED' ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Reenfileirar job"
                          onClick={() => void acao(`/print-jobs/${job.id}/retry`)}
                        >
                          <RotateCcw className="size-4" />
                        </Button>
                      ) : null}
                      {job.status === 'PENDING' || job.status === 'PRINTING' ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Cancelar job"
                          className="text-destructive"
                          onClick={() => void acao(`/print-jobs/${job.id}/cancel`)}
                        >
                          <Ban className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
