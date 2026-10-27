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
import { useAuth } from '@/lib/auth';
import { dataHora } from '@/lib/format';
import { ROTULO_PAPEL } from '@/lib/labels';
import type { Role } from '@leandrosys/shared';
import { Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import useSWR, { mutate } from 'swr';

type Usuario = { id: string; username: string; role: Role; createdAt: string };

type Formulario = {
  id: string | null;
  username: string;
  password: string;
  role: Role;
};

const VAZIO: Formulario = { id: null, username: '', password: '', role: 'WAITER' };
const PAPEIS: Role[] = ['ADMIN', 'WAITER', 'CASHIER', 'CHEF'];

export function AdminUsuariosPage() {
  const { user: sessao } = useAuth();
  const { data, error, isLoading } = useSWR<{ users: Usuario[] }>('/auth/users');
  const [form, setForm] = useState<Formulario>(VAZIO);
  const [aberto, setAberto] = useState(false);

  const usuarios = data?.users ?? [];

  function abrirEdicao(usuario?: Usuario) {
    setForm(
      usuario ? { id: usuario.id, username: usuario.username, password: '', role: usuario.role } : VAZIO,
    );
    setAberto(true);
  }

  async function salvar() {
    if (form.id) {
      const corpo: Record<string, unknown> = { role: form.role };
      if (form.password) corpo.password = form.password;
      await api(`/auth/users/${form.id}`, { method: 'PATCH', body: corpo });
    } else {
      await api('/auth/users', {
        method: 'POST',
        body: { username: form.username.trim(), password: form.password, role: form.role },
      });
    }
    await mutate('/auth/users');
  }

  async function excluir(usuario: Usuario) {
    await api(`/auth/users/${usuario.id}`, { method: 'DELETE' });
    await mutate('/auth/users');
  }

  function impedirEnter(evento: KeyboardEvent) {
    if (evento.key === 'Enter') evento.preventDefault();
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        titulo="Usuários"
        descricao="Acessos e papéis: ADMIN opera tudo, WAITER/CASHIER operam comandas, CHEF só lê."
        acao={
          <Button size="sm" onClick={() => abrirEdicao()}>
            <Plus className="size-4" aria-hidden="true" />
            Novo usuário
          </Button>
        }
      />

      {isLoading ? (
        <Carregando />
      ) : error ? (
        <ErroAviso erro={error} />
      ) : usuarios.length === 0 ? (
        <Vazio titulo="Nenhum usuário" />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead className="w-44">Papel</TableHead>
                <TableHead className="w-44">Criado em</TableHead>
                <TableHead className="w-40 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usuarios.map((usuario) => (
                <TableRow key={usuario.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
                      {usuario.username}
                      {usuario.id === sessao?.id ? (
                        <StatusBadge rotulo="você" tom="bg-accent text-accent-foreground" />
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>{ROTULO_PAPEL[usuario.role]}</TableCell>
                  <TableCell>{dataHora(usuario.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${usuario.username}`}
                        onClick={() => abrirEdicao(usuario)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <ConfirmarExclusao
                        gatilho={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Excluir ${usuario.username}`}
                            className="text-destructive"
                            disabled={usuario.id === sessao?.id}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        }
                        titulo={`Excluir "${usuario.username}"?`}
                        descricao="A API recusa excluir a própria conta ou o último administrador."
                        aoConfirmar={() => excluir(usuario)}
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
        titulo={form.id ? `Editar ${form.username}` : 'Novo usuário'}
        descricao={
          form.id
            ? 'Deixe a senha em branco para mantê-la.'
            : 'Senha com no mínimo 6 caracteres.'
        }
        aoFechar={() => setAberto(false)}
        aoSubmeter={salvar}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nome-usuario">Usuário</Label>
            <Input
              id="nome-usuario"
              required
              minLength={3}
              maxLength={40}
              disabled={!!form.id}
              value={form.username}
              onKeyDown={impedirEnter}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="senha-usuario">{form.id ? 'Nova senha' : 'Senha'}</Label>
            <Input
              id="senha-usuario"
              type="password"
              minLength={form.id ? undefined : 6}
              maxLength={100}
              autoComplete="new-password"
              required={!form.id}
              placeholder={form.id ? '•••••••• (manter)' : '••••••••'}
              value={form.password}
              onKeyDown={impedirEnter}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="papel-usuario">Papel</Label>
            <Select value={form.role} onValueChange={(valor) => setForm({ ...form, role: valor as Role })}>
              <SelectTrigger id="papel-usuario" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAPEIS.map((papel) => (
                  <SelectItem key={papel} value={papel}>
                    {ROTULO_PAPEL[papel]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
