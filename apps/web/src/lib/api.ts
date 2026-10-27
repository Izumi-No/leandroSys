import { API_BASE_PATH, type ApiError } from '@leandrosys/shared';

const TOKEN_KEY = 'leandrosys.token';

/** Erro HTTP da API: mantém `code`, `status` e `details` do contrato de erros. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiError['code'] | 'NETWORK';
  readonly details?: ApiError['details'];

  constructor(message: string, status: number, code: ApiError['code'] | 'NETWORK', details?: ApiError['details']) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Mensagem legível para o usuário (inclui o primeiro detalhe de validação). */
  get aviso(): string {
    const detalhe = this.details?.[0];
    return detalhe ? `${this.message} — ${detalhe.path}: ${detalhe.message}` : this.message;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

type Opcoes = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

/** Cliente mínimo da API: injeta o Bearer e normaliza o contrato de erro. */
export async function api<T>(caminho: string, opcoes: Opcoes = {}): Promise<T> {
  const token = getToken();
  const temCorpo = opcoes.body !== undefined;

  let resposta: Response;
  try {
    resposta = await fetch(`${API_BASE_PATH}${caminho}`, {
      method: opcoes.method ?? 'GET',
      signal: opcoes.signal,
      headers: {
        ...(temCorpo ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: temCorpo ? JSON.stringify(opcoes.body) : undefined,
    });
  } catch {
    throw new ApiRequestError('Sem conexão com a API', 0, 'NETWORK');
  }

  if (resposta.status === 204) return undefined as T;

  const texto = await resposta.text();
  const dados = texto ? (JSON.parse(texto) as unknown) : undefined;

  if (!resposta.ok) {
    const erro = (dados ?? {}) as Partial<ApiError>;
    throw new ApiRequestError(
      erro.error ?? `Erro ${resposta.status}`,
      resposta.status,
      erro.code ?? 'INTERNAL',
      erro.details,
    );
  }

  return dados as T;
}

/** Fetcher padrão do SWR: `useSWR('/tables')`. */
export const swrFetcher = <T,>(caminho: string): Promise<T> => api<T>(caminho);
