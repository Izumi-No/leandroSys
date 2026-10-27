import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin, requireAuth, requireOperator } from '../../lib/auth';
import { conflict, notFound } from '../../lib/errors';
import { parseBody, parseOptionalBody, parseParams } from '../../lib/validate';
import { db } from '../../prisma/db';
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

export const tableRoutes = new Hono();

/** Mapa de salão com a comanda em aberto de cada mesa. */
tableRoutes.get('/tables', requireAuth, async (c) => c.json({ tables: await listTables() }));

tableRoutes.post('/tables', requireAdmin(), async (c) => {
  const body = await parseBody(c, createTableSchema);
  const id = await createTable(body);
  return c.json({ table: { id } }, 201);
});

tableRoutes.patch('/tables/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, updateTableSchema);
  await updateTable(id, body);
  return c.json({ updated: true });
});

tableRoutes.delete('/tables/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  await deleteTable(id);
  return c.json({ deleted: true });
});

/** Ocupa a mesa e abre a comanda. */
tableRoutes.post('/tables/:id/take', requireOperator(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseOptionalBody(c, takeSchema);

  const comandaId = await takeTable(id, body.waiterId);
  const comanda = await loadComanda(comandaId);
  if (!comanda) throw notFound('Comanda não encontrada');

  return c.json({ comanda: serializeComandaDetail(comanda) }, 201);
});

/** Passa a comanda da mesa para outra mesa. */
tableRoutes.post('/tables/:id/transfer', requireOperator(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, transferSchema);

  const comanda = await db
    .selectFrom('Comanda')
    .selectAll()
    .where('tableId', '=', id)
    .where('status', '!=', 'CLOSED')
    .executeTakeFirst();
  if (!comanda) throw conflict('Mesa não possui comanda em aberto');

  const transfer = await transferComanda(comanda.id, body.toTableId);
  return c.json({ transfer });
});

tableRoutes.post('/tables/:id/reserve', requireOperator(), async (c) => {
  const { id } = parseParams(c, idParam);
  await reserveTable(id);
  return c.json({ reserved: true });
});

tableRoutes.delete('/tables/:id/reserve', requireOperator(), async (c) => {
  const { id } = parseParams(c, idParam);
  await cancelReservation(id);
  return c.json({ reserved: false });
});

/** Libera a mesa fechando a comanda em aberto (e imprimindo a conta). */
tableRoutes.post('/tables/:id/release', requireOperator(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseOptionalBody(c, releaseSchema);
  const result = await releaseTable(id, body.paymentMethod);
  return c.json({ released: true, ...result });
});
