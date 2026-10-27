import type { AuthUser, LoginResponse } from '@leandrosys/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import { api, ApiRequestError, getToken, setToken } from './api';

type AuthContextValue = {
  /** `undefined` = ainda validando o token; `null` = sem sessão. */
  user: AuthUser | null | undefined;
  carregando: boolean;
  entrar: (username: string, password: string) => Promise<void>;
  sair: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Espelha o token do localStorage para reagir a login/logout.
  const [token, definirToken] = useState<string | null>(() => getToken());
  const { mutate } = useSWRConfig();
  const navigate = useNavigate();

  const { data, error, isLoading } = useSWR(token ? '/auth/me' : null, {
    revalidateOnFocus: false,
  });

  const sair = useCallback(() => {
    setToken(null);
    definirToken(null);
    void mutate(() => true, undefined, { revalidate: false });
    navigate('/login', { replace: true });
  }, [mutate, navigate]);

  const entrar = useCallback(
    async (username: string, password: string) => {
      const { token: novo, user } = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      setToken(novo);
      definirToken(novo);
      await mutate('/auth/me', { user }, { revalidate: false });
      navigate('/', { replace: true });
    },
    [mutate, navigate],
  );

  const valor = useMemo<AuthContextValue>(() => {
    if (error) return { user: null, carregando: false, entrar, sair };
    if (isLoading) return { user: undefined, carregando: true, entrar, sair };
    return { user: (data as { user: AuthUser } | undefined)?.user ?? null, carregando: false, entrar, sair };
  }, [data, error, isLoading, entrar, sair]);

  // Token inválido/expirado (401 em /auth/me): limpa a sessão.
  useEffect(() => {
    if (error instanceof ApiRequestError && error.status === 401) {
      setToken(null);
      definirToken(null);
    }
  }, [error]);

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const contexto = useContext(AuthContext);
  if (!contexto) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return contexto;
}
