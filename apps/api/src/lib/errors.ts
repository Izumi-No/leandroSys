import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: ContentfulStatusCode, message: string, code = 'ERROR', details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const httpError = (
  status: ContentfulStatusCode,
  message: string,
  code?: string,
  details?: unknown,
): HttpError => new HttpError(status, message, code, details);

export const badRequest = (message: string, details?: unknown): HttpError =>
  httpError(400, message, 'BAD_REQUEST', details);

export const unauthorized = (message = 'Não autenticado'): HttpError =>
  httpError(401, message, 'UNAUTHORIZED');

export const forbidden = (message = 'Sem permissão para esta operação'): HttpError =>
  httpError(403, message, 'FORBIDDEN');

export const notFound = (message = 'Registro não encontrado'): HttpError =>
  httpError(404, message, 'NOT_FOUND');

export const conflict = (message: string, details?: unknown): HttpError =>
  httpError(409, message, 'CONFLICT', details);

const errorCode = (err: unknown): string => {
  if (typeof err !== 'object' || err === null) return '';
  // `SqlQueryError` do driver Postgres expõe o SQLSTATE em `sqlState`;
  // o erro original do `pg` traz o mesmo valor em `code`.
  for (const key of ['sqlState', 'code'] as const) {
    if (key in err) {
      const value = String((err as Record<string, unknown>)[key] ?? '');
      if (value) return value;
    }
  }
  return '';
};

/** 23505 unique · 23503 FK · 23514 check — erros de integridade do Postgres. */
const integrityViolation = (err: unknown): { status: 409; message: string } | null => {
  const code = errorCode(err);
  if (code === '23505' || code.includes('UNIQUE') || code.includes('DUPLICATE')) {
    return { status: 409, message: 'Já existe um registro com esses dados' };
  }
  if (code === '23503' || code.includes('FOREIGN KEY')) {
    return { status: 409, message: 'Registro em uso por outros dados — remova-os primeiro' };
  }
  if (code === '23514') {
    return { status: 409, message: 'Valor viola uma restrição de validação' };
  }
  return null;
};

export type ErrorBody = {
  error: string;
  code: string;
  details?: unknown;
};

export function errorResponse(err: unknown): { status: ContentfulStatusCode; body: ErrorBody } {
  if (err instanceof HttpError) {
    return {
      status: err.status,
      body: {
        error: err.message,
        code: err.code,
        ...(err.details === undefined ? {} : { details: err.details }),
      },
    };
  }

  const integrity = integrityViolation(err);
  if (integrity) {
    return { status: integrity.status, body: { error: integrity.message, code: 'CONFLICT' } };
  }

  console.error('[api] erro não tratado:', err);
  return { status: 500, body: { error: 'Erro interno do servidor', code: 'INTERNAL' } };
}
