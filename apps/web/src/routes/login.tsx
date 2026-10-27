import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AlertCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';

export function LoginPage() {
  const { entrar } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(username.trim(), password);
    } catch (falha) {
      setErro(
        falha instanceof ApiRequestError ? falha.message : 'Não foi possível conectar à API',
      );
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">
            l
          </span>
          <h1 className="text-balance text-xl font-semibold tracking-tight">leandroSys</h1>
          <p className="text-sm text-muted-foreground text-pretty">
            Sistema de comandas, mesas e impressão
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Entrar</CardTitle>
            <CardDescription>Use seu usuário e senha do estabelecimento</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void submeter(e)} className="flex flex-col gap-4">
              {erro ? (
                <Alert variant="destructive">
                  <AlertCircle className="size-4" />
                  <AlertTitle>Falha no acesso</AlertTitle>
                  <AlertDescription>{erro}</AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-col gap-2">
                <Label htmlFor="username">Usuário</Label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              <Button type="submit" disabled={enviando}>
                {enviando ? (
                  <>
                    <Spinner className="size-4" />
                    Entrando…
                  </>
                ) : (
                  'Entrar'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Usuários de teste: admin, garcom, caixa, cozinha
        </p>
      </div>
    </main>
  );
}
