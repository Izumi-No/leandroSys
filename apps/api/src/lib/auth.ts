import { createMiddleware } from 'hono/factory';
import { sign, verify } from 'hono/jwt';
import { env } from '../env';
import type { AppDb } from '../db';
import { forbidden, unauthorized } from './errors';

export type Role = 'ADMIN' | 'WAITER' | 'CASHIER' | 'CHEF';

export const ROLES: Role[] = ['ADMIN', 'WAITER', 'CASHIER', 'CHEF'];

export type AuthUser = {
  id: string;
  username: string;
  role: Role;
};

export type AppEnv = {
  Bindings: { DATABASE_URL?: string };
  Variables: { user: AuthUser; db: AppDb };
};

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 dias

export async function createToken(user: AuthUser): Promise<string> {
  return sign(
    { sub: user.id, username: user.username, role: user.role, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS },
    env.jwtSecret,
    'HS256',
  );
}

async function readToken(token: string): Promise<AuthUser> {
  const payload = await verify(token, env.jwtSecret, 'HS256');
  const { sub, username, role } = payload as { sub?: unknown; username?: unknown; role?: unknown };
  if (typeof sub !== 'string' || typeof username !== 'string' || typeof role !== 'string') {
    throw unauthorized('Token inválido');
  }
  if (!ROLES.includes(role as Role)) throw unauthorized('Token inválido');
  return { id: sub, username, role: role as Role };
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer ')) throw unauthorized('Token ausente');

  try {
    c.set('user', await readToken(header.slice(7)));
  } catch {
    throw unauthorized('Token inválido ou expirado');
  }

  await next();
});

/** Exige estar autenticado e ter um dos papéis informados. */
export const requireRole = (...roles: Role[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    await requireAuth(c, async () => {
      const user = c.get('user');
      if (!roles.includes(user.role)) throw forbidden();
      await next();
    });
  });

/** Papéis que operam mesas e comandas. */
export const requireOperator = () => requireRole('ADMIN', 'WAITER', 'CASHIER');

/** Papéis que fazem cadastro administrativo. */
export const requireAdmin = () => requireRole('ADMIN');
