import { Hono } from 'hono';
import { z } from 'zod';
import { createToken, requireAdmin, requireAuth } from '../../lib/auth';
import { conflict, notFound, unauthorized } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../lib/password';
import { parseBody, parseParams } from '../../lib/validate';
import { db } from '../../infrastructure/drizzle/db';
import { schema } from '../../infrastructure/drizzle/schema';
import { eq, asc } from 'drizzle-orm';

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

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
authRoutes.post('/login', async (c) => {
  const body = await parseBody(c, loginSchema);

  const rows = await db.select().from(schema.users).where(eq(schema.users.username, body.username)).limit(1);
  const user = rows[0];
  const valid = user ? await verifyPassword(body.password, user.password) : false;
  if (!user || !valid) throw unauthorized('Usuário ou senha inválidos');

  const authUser = { id: user.id, username: user.username, role: user.role };
  const token = await createToken(authUser);

  return c.json({ token, user: authUser });
});

authRoutes.get('/me', requireAuth, async (c) => c.json({ user: c.get('user') }));

// ---------------------------------------------------------------------------
// List users (admin only)
// ---------------------------------------------------------------------------
authRoutes.get('/users', requireAdmin(), async (c) => {
  const users = await db.select().from(schema.users).orderBy(asc(schema.users.username)).all();
  return c.json({ users: users.map(publicUser) });
});

// ---------------------------------------------------------------------------
// Create user (admin only)
// ---------------------------------------------------------------------------
authRoutes.post('/users', requireAdmin(), async (c) => {
  const body = await parseBody(c, createUserSchema);
  const password = await hashPassword(body.password);

  const [user] = await db
    .insert(schema.users)
    .values({ username: body.username, password, role: body.role, createdAt: new Date() })
    .returning();

  return c.json({ user: publicUser(user) }, 201);
});

// ---------------------------------------------------------------------------
// Get single user (admin only)
// ---------------------------------------------------------------------------
authRoutes.get('/users/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  const user = rows[0];
  if (!user) throw notFound('Usuário não encontrado');
  return c.json({ user: publicUser(user) });
});

// ---------------------------------------------------------------------------
// Update user (admin only)
// ---------------------------------------------------------------------------
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

  const rows = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  const existing = rows[0];
  if (!existing) throw notFound('Usuário não encontrado');

  const patch: any = {};
  if (body.password !== undefined) patch.password = await hashPassword(body.password);
  if (body.role !== undefined) patch.role = body.role;

  const [updated] = await db.update(schema.users).set(patch).where(eq(schema.users.id, id)).returning();
  return c.json({ user: publicUser(updated) });
});

// ---------------------------------------------------------------------------
// Delete user (admin only)
// ---------------------------------------------------------------------------
authRoutes.delete('/users/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);

  const rows = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  const user = rows[0];
  if (!user) throw notFound('Usuário não encontrado');
  if (id === c.get('user').id) throw conflict('Não é possível remover o próprio usuário');

  // Não deixa a instância ficar sem nenhum administrador.
  const adminRows = await db.select().from(schema.users).where(eq(schema.users.role, 'ADMIN')).all();
  if (user.role === 'ADMIN' && adminRows.length <= 1) throw conflict('Não é possível remover o último administrador');

  await db.delete(schema.users).where(eq(schema.users.id, id));
  return c.json({ id, deleted: true });
});
