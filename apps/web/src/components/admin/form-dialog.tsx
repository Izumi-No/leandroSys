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
import { Spinner } from '@/components/ui/spinner';
import { ApiRequestError } from '@/lib/api';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

type Props = {
  aberto: boolean;
  titulo: string;
  descricao?: string;
  rotuloSubmit?: string;
  aoFechar: () => void;
  aoSubmeter: () => Promise<void>;
  children: ReactNode;
};

/** Diálogo de formulário reutilizável do admin: erro, envio e rodapé padrão. */
export function FormDialog({
  aberto,
  titulo,
  descricao,
  rotuloSubmit = 'Salvar',
  aoFechar,
  aoSubmeter,
  children,
}: Props) {
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (aberto) {
      setErro(null);
      setEnviando(false);
    }
  }, [aberto]);

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await aoSubmeter();
      aoFechar();
    } catch (falha) {
      setErro(falha instanceof ApiRequestError ? falha.aviso : 'Erro inesperado');
      setEnviando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(valor) => !valor && aoFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {descricao ? <DialogDescription>{descricao}</DialogDescription> : null}
        </DialogHeader>

        <form onSubmit={(e) => void submeter(e)} className="flex flex-col gap-4">
          {erro ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>Não foi possível salvar</AlertTitle>
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          ) : null}

          {children}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={enviando}>
              {enviando ? <Spinner className="size-4" /> : null}
              {rotuloSubmit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
