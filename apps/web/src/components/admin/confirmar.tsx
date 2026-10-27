import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ApiRequestError } from '@/lib/api';
import { useState, type ReactNode } from 'react';

type Props = {
  gatilho: ReactNode;
  titulo: string;
  descricao: string;
  rotuloConfirmar?: string;
  aoConfirmar: () => Promise<void>;
};

/** Confirmação destrutiva (exclusão) com tratamento de erro 409/404 da API. */
export function ConfirmarExclusao({
  gatilho,
  titulo,
  descricao,
  rotuloConfirmar = 'Excluir',
  aoConfirmar,
}: Props) {
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);

  return (
    <AlertDialog
      open={aberto}
      onOpenChange={(valor) => {
        setAberto(valor);
        if (!valor) setErro(null);
      }}
    >
      <AlertDialogTrigger asChild>{gatilho}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription>{descricao}</AlertDialogDescription>
          {erro ? <p className="text-sm font-medium text-destructive">{erro}</p> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={!!erro}
            onClick={async (evento) => {
              // Mantém o diálogo aberto enquanto a requisição não terminar.
              evento.preventDefault();
              setErro(null);
              try {
                await aoConfirmar();
                setAberto(false);
              } catch (falha) {
                setErro(falha instanceof ApiRequestError ? falha.aviso : 'Erro inesperado');
              }
            }}
          >
            {rotuloConfirmar}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
