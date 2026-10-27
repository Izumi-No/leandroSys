import type { Context } from 'hono';
import type { z } from 'zod';
import { badRequest } from './errors';

type Issue = { path: string; message: string };

const issues = (error: z.ZodError): Issue[] =>
  error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(body)',
    message: issue.message,
  }));

const parse = <S extends z.ZodType>(schema: S, value: unknown): z.infer<S> => {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest('Dados inválidos', issues(result.error));
  return result.data as z.infer<S>;
};

export async function parseBody<S extends z.ZodType>(context: Context, schema: S): Promise<z.infer<S>> {
  const raw = await context.req.json().catch(() => null);
  if (raw === null) throw badRequest('Corpo da requisição deve ser JSON válido');
  return parse(schema, raw);
}

/** Como `parseBody`, mas trata requisição sem corpo como `{}`. */
export async function parseOptionalBody<S extends z.ZodType>(
  context: Context,
  schema: S,
): Promise<z.infer<S>> {
  const raw = await context.req.json().catch(() => ({}));
  return parse(schema, raw);
}

export function parseParams<S extends z.ZodType>(context: Context, schema: S): z.infer<S> {
  return parse(schema, context.req.param());
}

export function parseQuery<S extends z.ZodType>(context: Context, schema: S): z.infer<S> {
  return parse(schema, context.req.query());
}
