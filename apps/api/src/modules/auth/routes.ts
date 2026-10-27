import { Hono } from 'hono';
import { z } from 'zod';
import { createToken, requireAdmin, requireAuth } from '../../lib/auth';
import { conflict, notFound, unauthorized } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../lib/password';
import { parseBody, parseParams } from '../../lib/validate';
import { db } from '../../prisma/db';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const createUserSchema = z.object({
  username: z.string().min(3).max(40),
  password: z.string().min(6).max(100),
  role: z.enum(['ADMIN', 'WAITER', 'CASHIER', 'CHEF']),
});

const idParam = z.object({ id: z.uuid() });

const publicUser = (user: { id: string; username: string; role: string; createdAt: Date }) => ({
  id: user.id,
  username: user.username,
  role: user.role,
  createdAt: user.createdAt,
});

export const authRoutes = new Hono();

authRoutes.post('/login', async (c) => {
  const body = await parseBody(c, loginSchema);

  const user = await db.orm.public.User.where({ username: body.username }).first();
  const valid = user ? await verifyPassword(body.password, user.password) : false;
  if (!user || !valid) throw unauthorized('Usuário ou senha inválidos');

  const authUser = { id: user.id, username: user.username, role: user.role };
  const token = await createToken(authUser);

  return c.json({ token, user: authUser });
});

authRoutes.get('/me', requireAuth, async (c) => c.json({ user: c.get('user') }));

authRoutes.get('/users', requireAdmin(), async (c) => {
  const users = await db.orm.public.User.orderBy((user) => user.username.asc()).all();
  return c.json({ users: users.map(publicUser) });
});

authRoutes.post('/users', requireAdmin(), async (c) => {
  const body = await parseBody(c, createUserSchema);
  const password = await hashPassword(body.password);

  const user = await db.orm.public.User.create({
    username: body.username,
    password,
    role: body.role,
  });

  return c.json({ user: publicUser(user) }, 201);
});

authRoutes.get('/users/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const user = await db.orm.public.User.first({ id });
  if (!user) throw notFound('Usuário não encontrado');
  return c.json({ user: publicUser(user) });
});

const updateUserSchema = z
  .object({
    password: z.string().min(6).max(100).optional(),
    role: z.enum(['ADMIN', 'WAITER', 'CASHIER', 'CHEF']).optional(),
  })
  .refine((body) => body.password !== undefined || body.role !== undefined, {
    message: 'Informe password e/ou role',
  });

authRoutes.patch('/users/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, updateUserSchema);

  const existing = await db.orm.public.User.first({ id });
  if (!existing) throw notFound('Usuário não encontrado');

  const patch: { password?: string; role?: 'ADMIN' | 'WAITER' | 'CASHIER' | 'CHEF' } = {};
  if (body.password !== undefined) patch.password = await hashPassword(body.password);
  if (body.role !== undefined) patch.role = body.role;

  const user = await db.orm.public.User.where({ id }).update(patch);
  if (!user) throw notFound('Usuário não encontrado');
  return c.json({ user: publicUser(user) });
});

authRoutes.delete('/users/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);

  const user = await db.orm.public.User.first({ id });
  if (!user) throw notFound('Usuário não encontrado');
  if (id === c.get('user').id) throw conflict('Não é possível remover o próprio usuário');

  // Não deixa a instância ficar sem nenhum administrador.
  if (user.role === 'ADMIN') {
    const admins = await db.orm.public.User.where({ role: 'ADMIN' }).all();
    if (admins.length <= 1) throw conflict('Não é possível remover o último administrador');
  }

  await db.orm.public.User.where({ id }).delete();
  return c.json({ id, deleted: true });
});
