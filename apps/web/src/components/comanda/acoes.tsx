import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiRequestError } from '@/lib/api';
import { ROTULO_PAGAMENTO } from '@/lib/labels';
import type { ContaDTO, EnvioDTO } from '@/lib/types';
import {
  PAYMENT_METHODS,
  type ComandaDetailDTO as Detalhe,
  type PaymentMethod,
} from '@leandrosys/shared';
import { CircleAlert, Printer, Receipt, Send, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { mutate } from 'swr';

type Aviso = { titulo: string; linhas: string[]; tom: 'destrutivo' | 'informativo' };

export function ComandaAcoes({ comanda }: { comanda: Detalhe }) {
  const aberta = comanda.status === 'OPEN';
  const pendentes = comanda.items.filter((item) => item.status === 'PENDING' && !item.canceled).length;

  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [enviando, setEnviando] = useState<'send' | 'checkout' | 'close' | null>(null);
  const [dialogoConta, setDialogoConta] = useState(false);
  const [pagamento, setPagamento] = useState<PaymentMethod | ''>('');

  async function executar(qual: 'send' | 'checkout' | 'close', operacao: () => Promise<unknown>) {
    setAviso(null);
    setEnviando(qual);
    try {
      await operacao();
      await mutate((chave) => typeof chave === 'string' && chave.startsWith('/comandas'));
    } catch (falha) {
      setAviso({
        titulo: 'Operação não concluída',
        linhas: [falha instanceof ApiRequestError ? falha.aviso : 'Erro inesperado'],
        tom: 'destrutivo',
      });
    } finally {
      setEnviando(null);
    }
  }

  const enviar = () =>
    executar('send', async () => {
      const resultado = await api<EnvioDTO>(`/comandas/${comanda.id}/send`, {
        method: 'POST',
        body: {},
      });
      const linhas = [`${resultado.sent} item(ns) enviado(s) para impressão.`];
      if (resultado.unrouted.length > 0) {
        linhas.push(
          `Sem rota de impressão: ${resultado.unrouted.map((u) => u.product).join(', ')}`,
        );
        setAviso({ titulo: 'Itens enviados com ressalva', linhas, tom: 'destrutivo' });
      } else {
        setAviso({ titulo: 'Enviado para a cozinha/balcão', linhas, tom: 'informativo' });
      }
    });

  const gerarConta = () =>
    executar('checkout', async () => {
      const resultado = await api<ContaDTO>(`/comandas/${comanda.id}/checkout`, {
        method: 'POST',
        body: {},
      });
      const linhas =
        resultado.billJobId === null
          ? ['Comanda já estava em pagamento — conta não re impressa.']
          : ['Conta enviada para a impressora.'];
      setAviso({ titulo: 'Conta gerada', linhas: [...linhas, ...resultado.warnings], tom: 'informativo' });
    });

  function submeterConta(evento: FormEvent) {
    evento.preventDefault();
    void executar('close', async () => {
      const corpo = pagamento ? { paymentMethod: pagamento } : {};
      const resultado = await api<{ warnings: string[]; comanda: unknown }>(
        `/comandas/${comanda.id}/close`,
        { method: 'POST', body: corpo },
      );
      setDialogoConta(false);
      setPagamento('');
      const linhas = ['Comanda fechada e mesa liberada.'];
      setAviso({
        titulo: 'Comanda encerrada',
        linhas: [...linhas, ...resultado.warnings],
        tom: resultado.warnings.length > 0 ? 'destrutivo' : 'informativo',
      });
    });
  }

  return (
    <section aria-label="Ações da comanda" className="flex flex-col gap-3">
      {aviso ? (
        <Alert variant={aviso.tom === 'destrutivo' ? 'destructive' : 'default'}>
          <CircleAlert className="size-4" />
          <AlertTitle>{aviso.titulo}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {aviso.linhas.map((linha) => (
                <li key={linha}>{linha}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button
          onClick={() => void enviar()}
          disabled={!aberta || pendentes === 0 || enviando !== null}
        >
          {enviando === 'send' ? <Spinner className="size-4" /> : <Send className="size-4" />}
          Enviar pendentes ({pendentes})
        </Button>

        <Button variant="outline" onClick={() => void gerarConta()} disabled={enviando !== null}>
          {enviando === 'checkout' ? (
            <Spinner className="size-4" />
          ) : (
            <Receipt className="size-4" />
          )}
          Gerar conta
        </Button>

        <Button
          variant="destructive"
          onClick={() => setDialogoConta(true)}
          disabled={comanda.status === 'CLOSED' || enviando !== null}
        >
          <XCircle className="size-4" />
          Fechar comanda
        </Button>

        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Printer className="size-3" aria-hidden="true" />
          {aberta
            ? 'Envio e fechamento disponíveis.'
            : comanda.status === 'PAYING'
              ? 'Comanda em pagamento: só falta fechar.'
              : 'Comanda fechada: somente leitura.'}
        </p>
      </div>

      <Dialog open={dialogoConta} onOpenChange={setDialogoConta}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Fechar comanda #{comanda.number}</DialogTitle>
            <DialogDescription>
              Imprime a conta (se ainda estava aberta), grava a forma de pagamento e libera a mesa.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submeterConta} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="pagamento-comanda" className="text-sm font-medium">
                Forma de pagamento
              </label>
              <Select value={pagamento} onValueChange={(valor) => setPagamento(valor as PaymentMethod)}>
                <SelectTrigger id="pagamento-comanda" className="w-full">
                  <SelectValue placeholder="Selecione (opcional)" />
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
              <Button type="button" variant="outline" onClick={() => setDialogoConta(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="destructive" disabled={enviando !== null}>
                {enviando === 'close' ? <Spinner className="size-4" /> : null}
                Confirmar fechamento
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
