import { eq, ne, and } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin, requireAuth, requireOperator } from '../../lib/auth';
import type { AppEnv } from '../../lib/auth';
import { conflict, notFound } from '../../lib/errors';
import { parseBody, parseOptionalBody, parseParams } from '../../lib/validate';
import { comandas } from '../../db/schema';
import { loadComanda, serializeComandaDetail } from '../comandas/service';
import {
  cancelReservation,
  createTable,
  deleteTable,
  listTables,
  releaseTable,
  reserveTable,
  takeTable,
  transferComanda,
  updateTable,
} from './service';

const idParam = z.object({ id: z.uuid() });

const createTableSchema = z.object({
  number: z.number().int().min(1).max(999),
  capacity: z.number().int().min(1).max(50).optional(),
  label: z.string().max(60).nullable().optional(),
});

const updateTableSchema = createTableSchema.partial();

const takeSchema = z.object({ waiterId: z.string().min(1).nullable().optional() });
const transferSchema = z.object({ toTableId: z.uuid() });
const releaseSchema = z.object({
  paymentMethod: z.enum(['MONEY', 'CARD', 'PIX', 'OTHER']).optional(),
});

export const tableRoutes = new Hono<AppEnv>();

tableRoutes.get('/tables', requireAuth, async (c) => c.json({ tables: await listTables(c.get('db')) }));

tableRoutes.post('/tables', requireAdmin(), async (c) => {
  const body = await parseBody(c, createTableSchema);
  const id = await createTable(c.get('db'), body);
  return c.json({ table: { id } }, 201);
});

tableRoutes.patch('/tables/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, updateTableSchema);
  await updateTable(c.get('db'), id, body);
  return c.json({ updated: true });
});

tableRoutes.delete('/tables/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  await deleteTable(c.get('db'), id);
  return c.json({ deleted: true });
});

tableRoutes.post('/tables/:id/take', requireOperator(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseOptionalBody(c, takeSchema);
  const db = c.get('db');

  const comandaId = await takeTable(db, id, body.waiterId);
  const comanda = await loadComanda(db, comandaId);
  if (!comanda) throw notFound('Comanda não encontrada');

  return c.json({ comanda: serializeComandaDetail(comanda) }, 201);
});

tableRoutes.post('/tables/:id/transfer', requireOperator(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, transferSchema);
  const db = c.get('db');

  const [comanda] = await db
    .select()
    .from(comandas)
    .where(and(eq(comandas.tableId, id), ne(comandas.status, 'CLOSED')))
    .limit(1);
  if (!comanda) throw conflict('Mesa não possui comanda em aberto');

  const transfer = await transferComanda(db, comanda.id, body.toTableId);
  return c.json({ transfer });
});

tableRoutes.post('/tables/:id/reserve', requireOperator(), async (c) => {
  const { id } = parseParams(c, idParam);
  await reserveTable(c.get('db'), id);
  return c.json({ reserved: true });
});

tableRoutes.delete('/tables/:id/reserve', requireOperator(), async (c) => {
  const { id } = parseParams(c, idParam);
  await cancelReservation(c.get('db'), id);
  return c.json({ reserved: false });
});

tableRoutes.post('/tables/:id/release', requireOperator(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseOptionalBody(c, releaseSchema);
  const result = await releaseTable(c.get('db'), id, body.paymentMethod);
  return c.json({ released: true, ...result });
});
