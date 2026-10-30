import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin, requireAuth, requireRole } from '../../lib/auth';
import type { AppEnv } from '../../lib/auth';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { parseBody, parseParams, parseQuery } from '../../lib/validate';
import type { AppDb, DbLike } from '../../db';
import { categories, printJobs, printRoutes as printRouteTable, printers, products } from '../../db/schema';
import { parseTicketDoc, renderTicketBase64 } from '../printing/escpos';
import { enqueueJob } from '../printing/queue';
import { testTicket } from '../printing/tickets';
import { claimSchema } from './claim-contract';

/** Três tentativas antes do job ficar FAILED (vira de novo PENDING no erro). */
const MAX_ATTEMPTS = 3;
/** Job em PRINTING há mais tempo que isso volta para a fila (cliente caiu). */
const STALE_MS = 5 * 60 * 1000;
const CLAIM_DEFAULT = 8;
const QUEUE_DEFAULT = 50;

const idParam = z.object({ id: z.uuid() });
const jobStatus = z.enum(['PENDING', 'PRINTING', 'DONE', 'FAILED', 'CANCELED']);

const createPrinterSchema = z.object({
  name: z.string().min(1).max(60),
  address: z.string().max(120).optional(),
  transport: z.enum(['BLUETOOTH', 'USB', 'NETWORK']).optional(),
  columns: z.number().int().min(16).max(64).optional(),
  codepage: z.number().int().min(0).max(255).optional(),
  active: z.boolean().optional(),
  printsBill: z.boolean().optional(),
});

const updatePrinterSchema = createPrinterSchema.partial();

const createRouteSchema = z
  .object({
    printerId: z.uuid(),
    productId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    priority: z.number().int().min(0).max(99).optional(),
  })
  .refine((value) => Number(Boolean(value.productId)) + Number(Boolean(value.categoryId)) === 1, {
    message: 'Informe exatamente um alvo: productId OU categoryId',
    path: ['productId'],
  });

/** Atrela uma fila já cadastrada a um dispositivo descoberto pelo printd. */
const attachSchema = z.object({
  agentId: z.string().min(6).max(64),
  agentName: z.string().min(1).max(80),
  address: z.string().min(1).max(120),
  transport: z.enum(['BLUETOOTH', 'USB', 'NETWORK']),
  baud: z.number().int().min(1200).max(115200).optional(),
});

const detachSchema = z.object({
  agentId: z.string().min(6).max(64),
});

const ackSchema = z.object({
  success: z.boolean(),
  error: z.string().max(500).optional(),
});

const queueQuery = z.object({
  status: jobStatus.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const jobsQuery = z.object({
  printerId: z.uuid().optional(),
  status: jobStatus.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

type PrinterRow = Awaited<ReturnType<typeof loadPrinters>>[number];

async function loadPrinters(db: DbLike) {
  return db.select().from(printers).orderBy(asc(printers.name));
}

async function pendingCountsByPrinter(db: DbLike): Promise<Map<string, number>> {
  const rows = await db.select({ printerId: printJobs.printerId }).from(printJobs).where(eq(printJobs.status, 'PENDING'));
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.printerId, (counts.get(row.printerId) ?? 0) + 1);
  return counts;
}

const serializePrinter = (printer: PrinterRow, pending: number) => ({
  id: printer.id,
  name: printer.name,
  address: printer.address,
  transport: printer.transport,
  columns: printer.columns,
  codepage: printer.codepage,
  active: printer.active,
  printsBill: printer.printsBill,
  createdAt: printer.createdAt,
  pendingJobs: pending,
  agentId: printer.agentId,
  agentName: printer.agentName,
  baud: printer.baud,
  boundAt: printer.boundAt,
});

const serializeJob = (job: {
  id: string;
  printerId: string;
  comandaId: string | null;
  comandaItemId: string | null;
  kind: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  claimedAt: Date | null;
  finishedAt: Date | null;
  payload: unknown;
}) => ({
  id: job.id,
  printerId: job.printerId,
  comandaId: job.comandaId,
  comandaItemId: job.comandaItemId,
  kind: job.kind,
  status: job.status,
  attempts: job.attempts,
  lastError: job.lastError,
  createdAt: job.createdAt,
  claimedAt: job.claimedAt,
  finishedAt: job.finishedAt,
  payload: job.payload,
});

/** Só uma impressora fica como destino de conta por vez. */
async function applyPrintsBill(db: AppDb, printerId: string, value: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    if (value) {
      const holders = await tx.select({ id: printers.id }).from(printers).where(eq(printers.printsBill, true));
      for (const holder of holders) {
        if (holder.id !== printerId) {
          await tx.update(printers).set({ printsBill: false }).where(eq(printers.id, holder.id));
        }
      }
    }
    await tx.update(printers).set({ printsBill: value }).where(eq(printers.id, printerId));
  });
}

export const printRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Impressoras
// ---------------------------------------------------------------------------

printRoutes.get('/printers', requireAuth, async (c) => {
  const db = c.get('db');
  const [printerRows, counts] = await Promise.all([loadPrinters(db), pendingCountsByPrinter(db)]);
  return c.json({
    printers: printerRows.map((printer) => serializePrinter(printer, counts.get(printer.id) ?? 0)),
  });
});

printRoutes.post('/printers', requireAdmin(), async (c) => {
  const db = c.get('db');
  const body = await parseBody(c, createPrinterSchema);

  const [printer] = await db
    .insert(printers)
    .values({
      name: body.name,
      address: body.address?.trim() ?? '',
      transport: body.transport ?? 'BLUETOOTH',
      columns: body.columns ?? 32,
      codepage: body.codepage ?? 19,
      active: body.active ?? true,
      printsBill: false,
    })
    .returning();

  if (body.printsBill) await applyPrintsBill(db, printer.id, true);

  return c.json({ printer: serializePrinter(printer, 0) }, 201);
});

/**
 * Atrela uma fila já cadastrada a um dispositivo local descoberto pelo printd.
 * Não cria impressora: o cadastro da fila continua sendo do admin.
 */
printRoutes.post('/printers/:id/attach', requireRole('ADMIN', 'CHEF'), async (c) => {
  const db = c.get('db');
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, attachSchema);

  const [printer] = await db.select().from(printers).where(eq(printers.id, id)).limit(1);
  if (!printer) throw notFound('Impressora não encontrada');

  if (printer.agentId && printer.agentId !== body.agentId) {
    throw conflict(`Impressora já atrelada a outro agente (${printer.agentName ?? 'desconhecido'})`);
  }

  const baud = body.transport === 'USB' ? (body.baud ?? 9600) : null;
  const [atualizada] = await db
    .update(printers)
    .set({
      address: body.address.trim(),
      transport: body.transport,
      baud,
      agentId: body.agentId,
      agentName: body.agentName,
      boundAt: new Date(),
    })
    .where(eq(printers.id, id))
    .returning();
  if (!atualizada) throw notFound('Impressora não encontrada');

  const counts = await pendingCountsByPrinter(db);
  return c.json({ printer: serializePrinter(atualizada, counts.get(id) ?? 0) });
});

/** Libera a fila para outro agente. A fila, rotas e histórico são preservados. */
printRoutes.post('/printers/:id/detach', requireAuth, async (c) => {
  const db = c.get('db');
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, detachSchema);

  const [printer] = await db.select().from(printers).where(eq(printers.id, id)).limit(1);
  if (!printer) throw notFound('Impressora não encontrada');

  const usuario = c.get('user');
  if (usuario.role !== 'ADMIN' && printer.agentId && printer.agentId !== body.agentId) {
    throw forbidden('Impressora atrelada a outro agente');
  }
  if (!printer.agentId) {
    return c.json({ printer: serializePrinter(printer, 0), alreadyDetached: true });
  }

  const [atualizada] = await db
    .update(printers)
    .set({
      agentId: null,
      agentName: null,
      baud: null,
      boundAt: null,
    })
    .where(eq(printers.id, id))
    .returning();
  if (!atualizada) throw notFound('Impressora não encontrada');

  const counts = await pendingCountsByPrinter(db);
  return c.json({ printer: serializePrinter(atualizada, counts.get(id) ?? 0) });
});

printRoutes.patch('/printers/:id', requireAdmin(), async (c) => {
  const db = c.get('db');
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, updatePrinterSchema);

  const [existing] = await db.select().from(printers).where(eq(printers.id, id)).limit(1);
  if (!existing) throw notFound('Impressora não encontrada');

  const patch: Partial<typeof printers.$inferInsert> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.address !== undefined) patch.address = body.address.trim();
  if (body.transport !== undefined) patch.transport = body.transport;
  if (body.columns !== undefined) patch.columns = body.columns;
  if (body.codepage !== undefined) patch.codepage = body.codepage;
  if (body.active !== undefined) patch.active = body.active;

  let printer: PrinterRow = existing;
  if (Object.keys(patch).length > 0) {
    const [updated] = await db.update(printers).set(patch).where(eq(printers.id, id)).returning();
    if (!updated) throw notFound('Impressora não encontrada');
    printer = updated;
  }

  if (body.printsBill !== undefined) await applyPrintsBill(db, id, body.printsBill);

  const counts = await pendingCountsByPrinter(db);
  return c.json({ printer: serializePrinter(printer, counts.get(id) ?? 0) });
});

printRoutes.delete('/printers/:id', requireAdmin(), async (c) => {
  const db = c.get('db');
  const { id } = parseParams(c, idParam);

  const [printer] = await db.select().from(printers).where(eq(printers.id, id)).limit(1);
  if (!printer) throw notFound('Impressora não encontrada');

  const activeJobs = await db
    .select({ id: printJobs.id })
    .from(printJobs)
    .where(and(eq(printJobs.printerId, id), inArray(printJobs.status, ['PENDING', 'PRINTING'])));
  if (activeJobs.length > 0) throw conflict('Impressora tem jobs na fila; espere terminar ou cancele-os');

  await db.delete(printers).where(eq(printers.id, id));
  return c.json({ deleted: true });
});

printRoutes.post('/printers/:id/test', requireRole('ADMIN', 'CHEF'), async (c) => {
  const db = c.get('db');
  const { id } = parseParams(c, idParam);

  const [printer] = await db.select().from(printers).where(eq(printers.id, id)).limit(1);
  if (!printer) throw notFound('Impressora não encontrada');
  if (!printer.active) throw conflict('Impressora está inativa');

  const jobId = await enqueueJob(db, {
    printerId: printer.id,
    kind: 'TEST',
    payload: testTicket(printer.name, printer.columns),
  });

  return c.json({ jobId }, 201);
});

/** Fila de uma impressora (metadados + payload). */
printRoutes.get('/printers/:id/queue', requireAuth, async (c) => {
  const db = c.get('db');
  const { id } = parseParams(c, idParam);
  const query = parseQuery(c, queueQuery);

  const [printer] = await db.select().from(printers).where(eq(printers.id, id)).limit(1);
  if (!printer) throw notFound('Impressora não encontrada');

  const jobs = await db
    .select()
    .from(printJobs)
    .where(and(eq(printJobs.printerId, id), query.status ? eq(printJobs.status, query.status) : undefined))
    .orderBy(desc(printJobs.createdAt))
    .limit(query.limit ?? QUEUE_DEFAULT);

  return c.json({ printer: serializePrinter(printer, 0), jobs: jobs.map(serializeJob) });
});

// ---------------------------------------------------------------------------
// Rotas de impressão (produto ou categoria -> impressora)
// ---------------------------------------------------------------------------

printRoutes.get('/print-routes', requireAuth, async (c) => {
  const db = c.get('db');
  const [routes, printerRows, productRows, categoryRows] = await Promise.all([
    db.select().from(printRouteTable).orderBy(desc(printRouteTable.createdAt)),
    db.select({ id: printers.id, name: printers.name }).from(printers),
    db.select({ id: products.id, name: products.name }).from(products),
    db.select({ id: categories.id, name: categories.name }).from(categories),
  ]);

  const printerById = new Map(printerRows.map((printer) => [printer.id, printer]));
  const productById = new Map(productRows.map((product) => [product.id, product]));
  const categoryById = new Map(categoryRows.map((category) => [category.id, category]));

  return c.json({
    routes: routes.map((route) => {
      const printer = printerById.get(route.printerId);
      const product = route.productId ? productById.get(route.productId) : undefined;
      const category = route.categoryId ? categoryById.get(route.categoryId) : undefined;
      return {
        id: route.id,
        priority: route.priority,
        createdAt: route.createdAt,
        printer: { id: route.printerId, name: printer?.name ?? '' },
        target: product
          ? { scope: 'PRODUCT' as const, id: product.id, name: product.name }
          : { scope: 'CATEGORY' as const, id: category?.id ?? '', name: category?.name ?? '' },
        productId: route.productId,
        categoryId: route.categoryId,
      };
    }),
  });
});

printRoutes.post('/print-routes', requireAdmin(), async (c) => {
  const db = c.get('db');
  const body = await parseBody(c, createRouteSchema);

  const [printer] = await db.select().from(printers).where(eq(printers.id, body.printerId)).limit(1);
  if (!printer) throw notFound('Impressora não encontrada');

  if (body.productId) {
    const [product] = await db.select().from(products).where(eq(products.id, body.productId)).limit(1);
    if (!product) throw notFound('Produto não encontrado');

    const [duplicate] = await db
      .select({ id: printRouteTable.id })
      .from(printRouteTable)
      .where(and(eq(printRouteTable.printerId, printer.id), eq(printRouteTable.productId, body.productId)))
      .limit(1);
    if (duplicate) throw conflict('Já existe rota deste produto para esta impressora');

    const [route] = await db
      .insert(printRouteTable)
      .values({
        printerId: printer.id,
        productId: body.productId,
        categoryId: null,
        priority: body.priority ?? 0,
      })
      .returning({ id: printRouteTable.id, productId: printRouteTable.productId, categoryId: printRouteTable.categoryId });
    return c.json({ route }, 201);
  }

  const categoryId = body.categoryId!;
  const [category] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (!category) throw notFound('Categoria não encontrada');

  const [duplicate] = await db
    .select({ id: printRouteTable.id })
    .from(printRouteTable)
    .where(and(eq(printRouteTable.printerId, printer.id), eq(printRouteTable.categoryId, categoryId)))
    .limit(1);
  if (duplicate) throw conflict('Já existe rota desta categoria para esta impressora');

  const [route] = await db
    .insert(printRouteTable)
    .values({
      printerId: printer.id,
      categoryId,
      productId: null,
      priority: body.priority ?? 0,
    })
    .returning({ id: printRouteTable.id, productId: printRouteTable.productId, categoryId: printRouteTable.categoryId });
  return c.json({ route }, 201);
});

printRoutes.delete('/print-routes/:id', requireAdmin(), async (c) => {
  const db = c.get('db');
  const { id } = parseParams(c, idParam);

  const [route] = await db.select({ id: printRouteTable.id }).from(printRouteTable).where(eq(printRouteTable.id, id)).limit(1);
  if (!route) throw notFound('Rota não encontrada');

  await db.delete(printRouteTable).where(eq(printRouteTable.id, id));
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Fila de jobs
// ---------------------------------------------------------------------------

printRoutes.get('/print-jobs', requireAuth, async (c) => {
  const db = c.get('db');
  const query = parseQuery(c, jobsQuery);

  const conditions = [];
  if (query.printerId) conditions.push(eq(printJobs.printerId, query.printerId));
  if (query.status) conditions.push(eq(printJobs.status, query.status));

  const jobs = await db
    .select()
    .from(printJobs)
    .where(and(...conditions))
    .orderBy(desc(printJobs.createdAt))
    .limit(query.limit ?? QUEUE_DEFAULT);

  return c.json({ jobs: jobs.map(serializeJob) });
});

/**
 * O cliente (Electron) "pega" jobs da fila: PENDING -> PRINTING e devolve os
 * bytes ESC/POS prontos. Jobs abandonados há 5min voltam para PENDING.
 */
printRoutes.post('/print-jobs/claim', requireAuth, async (c) => {
  const db = c.get('db');
  const body = await parseBody(c, claimSchema);

  const [printer] = await db.select().from(printers).where(eq(printers.id, body.printerId)).limit(1);
  if (!printer) throw notFound('Impressora não encontrada');
  if (!printer.active) throw conflict('Impressora está inativa');
  if (!printer.agentId) throw conflict('Impressora não está atrelada a nenhum agente');
  if (printer.agentId !== body.agentId) throw conflict('Impressora atrelada a outro agente');

  const staleCutoff = new Date(Date.now() - STALE_MS);

  const claimed = await db.transaction(async (tx) => {
    await tx
      .update(printJobs)
      .set({ status: 'PENDING', claimedAt: null })
      .where(
        and(
          eq(printJobs.printerId, printer.id),
          eq(printJobs.status, 'PRINTING'),
          lt(printJobs.claimedAt, staleCutoff),
        ),
      );

    const jobs = await tx
      .select()
      .from(printJobs)
      .where(and(eq(printJobs.printerId, printer.id), eq(printJobs.status, 'PENDING')))
      .orderBy(asc(printJobs.createdAt))
      .limit(body.limit ?? CLAIM_DEFAULT)
      .for('update', { skipLocked: true });

    const rows: (typeof printJobs.$inferSelect)[] = [];
    for (const job of jobs) {
      const [updated] = await tx
        .update(printJobs)
        .set({ status: 'PRINTING', attempts: job.attempts + 1, claimedAt: new Date() })
        .where(eq(printJobs.id, job.id))
        .returning();
      if (updated) rows.push(updated);
    }
    return rows;
  });

  const jobs = claimed.map((job) => ({
    id: job.id,
    kind: job.kind,
    status: job.status,
    attempts: job.attempts,
    claimedAt: job.claimedAt,
    comandaId: job.comandaId,
    comandaItemId: job.comandaItemId,
    columns: printer.columns,
    codepage: printer.codepage,
    data: renderTicketBase64(parseTicketDoc(job.payload), {
      columns: printer.columns,
      codepage: printer.codepage,
    }),
  }));

  return c.json({ jobs });
});

/** Resultado do envio físico: sucesso finaliza; erro tenta de novo ou falha. */
printRoutes.post('/print-jobs/:id/ack', requireAuth, async (c) => {
  const db = c.get('db');
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, ackSchema);

  const [job] = await db.select().from(printJobs).where(eq(printJobs.id, id)).limit(1);
  if (!job) throw notFound('Job não encontrado');
  if (job.status === 'DONE' || job.status === 'CANCELED') {
    return c.json({ id, status: job.status, alreadyFinished: true });
  }
  // Ack atrasado: o job já saiu de PRINTING (voltou para a fila por timeout ou
  // falha anterior) — pode já estar com outro cliente, então não aplicamos.
  if (job.status === 'PENDING') throw conflict('Job não está em impressão');

  if (body.success) {
    await db
      .update(printJobs)
      .set({ status: 'DONE', finishedAt: new Date(), lastError: null })
      .where(eq(printJobs.id, id));
    return c.json({ id, status: 'DONE', attempts: job.attempts });
  }

  const lastError = (body.error ?? 'Falha desconhecida').slice(0, 500);

  if (job.status === 'FAILED' || job.attempts >= MAX_ATTEMPTS) {
    await db
      .update(printJobs)
      .set({ status: 'FAILED', lastError, finishedAt: new Date() })
      .where(eq(printJobs.id, id));
    return c.json({ id, status: 'FAILED', attempts: job.attempts });
  }

  await db
    .update(printJobs)
    .set({ status: 'PENDING', lastError, claimedAt: null })
    .where(eq(printJobs.id, id));
  return c.json({ id, status: 'PENDING', attempts: job.attempts });
});

/** Devolve um job FAILED/CANCELED para a fila. */
printRoutes.post('/print-jobs/:id/retry', requireAuth, async (c) => {
  const db = c.get('db');
  const { id } = parseParams(c, idParam);

  const [job] = await db.select().from(printJobs).where(eq(printJobs.id, id)).limit(1);
  if (!job) throw notFound('Job não encontrado');
  if (job.status === 'DONE') throw conflict('Job já foi impresso');
  if (job.status === 'PENDING' || job.status === 'PRINTING') throw badRequest('Job já está na fila');

  await db
    .update(printJobs)
    .set({ status: 'PENDING', attempts: 0, lastError: null, claimedAt: null, finishedAt: null })
    .where(eq(printJobs.id, id));
  return c.json({ id, status: 'PENDING' });
});

printRoutes.post('/print-jobs/:id/cancel', requireAuth, async (c) => {
  const db = c.get('db');
  const { id } = parseParams(c, idParam);

  const [job] = await db.select().from(printJobs).where(eq(printJobs.id, id)).limit(1);
  if (!job) throw notFound('Job não encontrado');
  if (job.status === 'DONE') throw conflict('Job já foi impresso');

  await db
    .update(printJobs)
    .set({ status: 'CANCELED', finishedAt: new Date() })
    .where(eq(printJobs.id, id));
  return c.json({ id, status: 'CANCELED' });
});
