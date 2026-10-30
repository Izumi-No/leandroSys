import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireOperator } from '../../lib/auth';
import type { AppEnv } from '../../lib/auth';
import { notFound } from '../../lib/errors';
import { parseBody, parseOptionalBody, parseParams, parseQuery } from '../../lib/validate';
import {
  addItem,
  checkoutComanda,
  closeComanda,
  deleteComanda,
  listComandas,
  loadComanda,
  openComanda,
  removeItem,
  reprintItem,
  serializeComandaDetail,
  serializeComandaSummary,
  sendComanda,
  updateItem,
} from './service';

const idParam = z.object({ id: z.uuid() });
const itemParam = z.object({ id: z.uuid(), itemId: z.uuid() });

const openSchema = z.object({
  tableId: z.uuid(),
  waiterId: z.string().min(1).nullable().optional(),
});

const statusQuery = z.object({
  status: z.enum(['OPEN', 'PAYING', 'CLOSED']).optional(),
});

const addItemSchema = z.object({
  productId: z.uuid(),
  quantity: z.number().int().min(1).max(99).optional(),
  note: z.string().max(200).nullable().optional(),
  aditionalIds: z.array(z.uuid()).max(20).optional(),
});

const updateItemSchema = z.object({
  quantity: z.number().int().min(1).max(99).optional(),
  note: z.string().max(200).nullable().optional(),
  status: z.enum(['IN_PREP', 'READY', 'SERVED']).optional(),
});

const closeSchema = z.object({
  paymentMethod: z.enum(['MONEY', 'CARD', 'PIX', 'OTHER']).optional(),
});

export const comandaRoutes = new Hono<AppEnv>();

comandaRoutes.get('/comandas', requireAuth, async (c) => {
  const query = parseQuery(c, statusQuery);
  const comandas = await listComandas(c.get('db'), query.status);
  return c.json({ comandas: comandas.map(serializeComandaSummary) });
});

comandaRoutes.post('/comandas', requireOperator(), async (c) => {
  const body = await parseBody(c, openSchema);
  const comandaId = await openComanda(c.get('db'), { tableId: body.tableId, waiterId: body.waiterId });

  const comanda = await loadComanda(c.get('db'), comandaId);
  if (!comanda) throw notFound('Comanda não encontrada');
  return c.json({ comanda: serializeComandaDetail(comanda) }, 201);
});

comandaRoutes.get('/comandas/:id', requireAuth, async (c) => {
  const { id } = parseParams(c, idParam);
  const comanda = await loadComanda(c.get('db'), id);
  if (!comanda) throw notFound('Comanda não encontrada');
  return c.json({ comanda: serializeComandaDetail(comanda) });
});

comandaRoutes.post('/comandas/:id/items', requireOperator(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, addItemSchema);

  await addItem(c.get('db'), id, {
    productId: body.productId,
    quantity: body.quantity ?? 1,
    note: body.note,
    aditionalIds: body.aditionalIds,
  });

  const comanda = await loadComanda(c.get('db'), id);
  if (!comanda) throw notFound('Comanda não encontrada');
  return c.json({ comanda: serializeComandaDetail(comanda) }, 201);
});

comandaRoutes.patch('/comandas/:id/items/:itemId', requireOperator(), async (c) => {
  const { id, itemId } = parseParams(c, itemParam);
  const body = await parseBody(c, updateItemSchema);
  await updateItem(c.get('db'), id, itemId, body);
  return c.json({ updated: true });
});

comandaRoutes.delete('/comandas/:id/items/:itemId', requireOperator(), async (c) => {
  const { id, itemId } = parseParams(c, itemParam);
  const result = await removeItem(c.get('db'), id, itemId);
  return c.json({ result });
});

/** Envia os itens pendentes para as impressoras das rotas (item > categoria). */
comandaRoutes.post('/comandas/:id/send', requireOperator(), async (c) => {
  const { id } = parseParams(c, idParam);
  const result = await sendComanda(c.get('db'), id);
  return c.json({
    jobIds: result.jobIds,
    sent: result.sentItems.length,
    unrouted: result.unrouted,
  });
});

/** Reimprime um item já enviado. */
comandaRoutes.post('/comandas/:id/items/:itemId/reprint', requireOperator(), async (c) => {
  const { id, itemId } = parseParams(c, itemParam);
  const jobIds = await reprintItem(c.get('db'), id, itemId);
  return c.json({ jobIds });
});

/** Abre o fechamento: imprime a conta e leva a comanda para PAYING. */
comandaRoutes.post('/comandas/:id/checkout', requireOperator(), async (c) => {
  const { id } = parseParams(c, idParam);
  const result = await checkoutComanda(c.get('db'), id);
  return c.json(result);
});

/** Fecha a comanda, imprime a conta (se preciso) e libera a mesa. */
comandaRoutes.post('/comandas/:id/close', requireOperator(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseOptionalBody(c, closeSchema);

  const result = await closeComanda(c.get('db'), id, body.paymentMethod);
  const comanda = await loadComanda(c.get('db'), id);

  return c.json({
    ...result,
    comanda: comanda ? serializeComandaDetail(comanda) : null,
  });
});

comandaRoutes.delete('/comandas/:id', requireOperator(), async (c) => {
  const { id } = parseParams(c, idParam);
  await deleteComanda(c.get('db'), id);
  return c.json({ deleted: true });
});
