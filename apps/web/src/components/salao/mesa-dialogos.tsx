import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { api, ApiRequestError } from '@/lib/api';
import { brl } from '@/lib/format';
import { PAYMENT_METHODS, type TableDTO } from '@leandrosys/shared';
import { ROTULO_PAGAMENTO } from '@/lib/labels';
import { useEffect, useState, type FormEvent } from 'react';
import { mutate } from 'swr';
import { AlertTriangle } from 'lucide-react';

function mensagemDeErro(falha: unknown): string {
  return falha instanceof ApiRequestError ? falha.aviso : 'Erro inesperado';
}

/** Transfere a comanda de uma mesa ocupada para outra livre. */
export function TransferirDialog({
  mesa,
  destinos,
  aoFechar,
}: {
  mesa: TableDTO | null;
  destinos: TableDTO[];
  aoFechar: () => void;
}) {
  const [destino, setDestino] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Reinicia o formulário sempre que uma mesa diferente é selecionada.
  useEffect(() => {
    setDestino('');
    setErro(null);
    setEnviando(false);
  }, [mesa?.id]);

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    if (!mesa || !destino) return;
    setErro(null);
    setEnviando(true);
    try {
      await api(`/tables/${mesa.id}/transfer`, { method: 'POST', body: { toTableId: destino } });
      await mutate('/tables');
      aoFechar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      setEnviando(false);
    }
  }

  return (
    <Dialog open={!!mesa} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir mesa {mesa?.number}</DialogTitle>
          <DialogDescription>
            A comanda em aberto passa para a mesa de destino escolhida.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void submeter(e)} className="flex flex-col gap-4">
          {erro ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>Não foi possível transferir</AlertTitle>
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="destino">Mesa de destino</Label>
            <Select value={destino} onValueChange={setDestino}>
              <SelectTrigger id="destino" className="w-full">
                <SelectValue placeholder="Escolha uma mesa livre" />
              </SelectTrigger>
              <SelectContent>
                {destinos.map((opcao) => (
                  <SelectItem key={opcao.id} value={opcao.id}>
                    Mesa {opcao.number}
                    {opcao.label ? ` — ${opcao.label}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {destinos.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma mesa livre no momento.</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={enviando || !destino}>
              {enviando ? <Spinner className="size-4" /> : null}
              Transferir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Fecha a comanda da mesa, imprime a conta e libera (com forma de pagamento opcional). */
export function LiberarDialog({ mesa, aoFechar }: { mesa: TableDTO | null; aoFechar: () => void }) {
  const [pagamento, setPagamento] = useState<string>('');
  const [erro, setErro] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setPagamento('');
    setErro(null);
    setAvisos([]);
    setEnviando(false);
  }, [mesa?.id]);

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    if (!mesa) return;
    setErro(null);
    setAvisos([]);
    setEnviando(true);
    try {
      const corpo = pagamento ? { paymentMethod: pagamento } : undefined;
      const resultado = await api<{ released: boolean; warnings: string[] }>(
        `/tables/${mesa.id}/release`,
        { method: 'POST', body: corpo },
      );
      await Promise.all([mutate('/tables'), mutate('/comandas')]);
      if (resultado.warnings.length > 0) {
        // Mantém o diálogo aberto para exibir os avisos do fechamento.
        setAvisos(resultado.warnings);
        setEnviando(false);
        return;
      }
      aoFechar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      setEnviando(false);
    }
  }

  return (
    <Dialog open={!!mesa} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Liberar mesa {mesa?.number}</DialogTitle>
          <DialogDescription>
            Fecha a comanda, imprime a conta (se houver impressora configurada) e devolve a mesa
            para livre.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void submeter(e)} className="flex flex-col gap-4">
          {mesa?.comanda ? (
            <div className="flex items-center justify-between rounded-lg bg-secondary/60 px-3 py-2 text-sm">
              <span>
                Comanda #{mesa.comanda.number} · {mesa.comanda.itemCount} item(ns)
              </span>
              <span className="font-mono font-semibold">{brl(mesa.comanda.total)}</span>
            </div>
          ) : null}

          {erro ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>Não foi possível liberar</AlertTitle>
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          ) : null}

          {avisos.length > 0 ? (
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertTitle>Mesa liberada com avisos</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {avisos.map((aviso) => (
                    <li key={aviso}>{aviso}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="pagamento">Forma de pagamento (opcional)</Label>
            <Select value={pagamento} onValueChange={setPagamento}>
              <SelectTrigger id="pagamento" className="w-full">
                <SelectValue placeholder="Não informar" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((metodo) => (
                  <SelectItem key={metodo} value={metodo}>
                    {ROTULO_PAGAMENTO[metodo]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            {avisos.length > 0 ? (
              <Button type="button" onClick={aoFechar}>
                Concluir
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={aoFechar}>
                  Cancelar
                </Button>
                <Button type="submit" variant="destructive" disabled={enviando}>
                  {enviando ? <Spinner className="size-4" /> : null}
                  Liberar mesa
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
