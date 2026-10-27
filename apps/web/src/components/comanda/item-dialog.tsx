import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiRequestError } from '@/lib/api';
import { brl } from '@/lib/format';
import { mutate } from 'swr';
import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, Minus, Plus } from 'lucide-react';

type ProdutoPainel = { id: string; name: string; price: string; categoryId: string };
type Adicional = { id: string; name: string; price: string };

/** Diálogo de lançamento: quantidade, observação e adicionais do produto. */
export function ItemDialog({
  produto,
  comandaId,
  aditionals,
  aoFechar,
}: {
  produto: ProdutoPainel | null;
  comandaId: string;
  aditionals: Adicional[];
  aoFechar: () => void;
}) {
  const [quantidade, setQuantidade] = useState(1);
  const [nota, setNota] = useState('');
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setQuantidade(1);
    setNota('');
    setSelecionados([]);
    setErro(null);
    setEnviando(false);
  }, [produto?.id]);

  function alternarAdicional(id: string) {
    setSelecionados((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    if (!produto) return;
    setErro(null);
    setEnviando(true);
    try {
      await api(`/comandas/${comandaId}/items`, {
        method: 'POST',
        body: {
          productId: produto.id,
          quantity: quantidade,
          ...(nota.trim() ? { note: nota.trim() } : {}),
          ...(selecionados.length ? { aditionalIds: selecionados } : {}),
        },
      });
      await mutate((chave) => typeof chave === 'string' && chave.startsWith('/comandas'));
      aoFechar();
    } catch (falha) {
      setErro(falha instanceof ApiRequestError ? falha.aviso : 'Erro inesperado');
      setEnviando(false);
    }
  }

  const adicionalTotal = aditionals
    .filter((adicional) => selecionados.includes(adicional.id))
    .reduce((soma, adicional) => soma + Number(adicional.price), 0);
  const total = produto ? (Number(produto.price) + adicionalTotal) * quantidade : 0;

  return (
    <Dialog open={!!produto} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{produto?.name}</DialogTitle>
          <DialogDescription>
            {produto ? `${brl(produto.price)} por unidade` : ''}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void submeter(e)} className="flex flex-col gap-4">
          {erro ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>Não foi possível lançar</AlertTitle>
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="quantidade">Quantidade</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Diminuir quantidade"
                onClick={() => setQuantidade((q) => Math.max(1, q - 1))}
              >
                <Minus className="size-4" />
              </Button>
              <Input
                id="quantidade"
                type="number"
                min={1}
                max={99}
                className="w-16 text-center"
                value={quantidade}
                onChange={(e) => setQuantidade(Math.min(99, Math.max(1, Number(e.target.value) || 1)))}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Aumentar quantidade"
                onClick={() => setQuantidade((q) => Math.min(99, q + 1))}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="nota">Observação</Label>
            <Textarea
              id="nota"
              maxLength={200}
              placeholder="Ex.: sem cebola, ponto da carne…"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">{nota.length}/200</span>
          </div>

          {aditionals.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Adicionais</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {aditionals.map((adicional) => (
                  <label
                    key={adicional.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-secondary"
                  >
                    <Checkbox
                      checked={selecionados.includes(adicional.id)}
                      onCheckedChange={() => alternarAdicional(adicional.id)}
                    />
                    <span className="flex-1">{adicional.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      +{brl(adicional.price)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className="flex items-center justify-between rounded-lg bg-secondary/60 px-3 py-2 text-sm">
            <span>Total do lançamento</span>
            <span className="font-mono font-semibold">{brl(total.toFixed(2))}</span>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={enviando}>
              {enviando ? <Spinner className="size-4" /> : null}
              Lançar item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
