import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin, requireAuth, requireRole } from '../../lib/auth';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { parseBody, parseParams, parseQuery } from '../../lib/validate';
import { db } from '../../infrastructure/drizzle/db';
import { schema } from '../../infrastructure/drizzle/schema';
import { eq, asc, desc, and, inArray, sql } from 'drizzle-orm';
import { renderTicketBase64, type TicketDoc } from '../printing/escpos';
import { enqueueJob } from '../printing/queue';
import { testTicket } from '../printing/tickets';

const MAX_ATTEMPTS = 3;
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
  .refine((v) => Number(Boolean(v.productId)) + Number(Boolean(v.categoryId)) === 1, {
    message: 'Informe exatamente um alvo: productId OU categoryId',
    path: ['productId'],
  });

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

type JobRow = Awaited<ReturnType<typeof loadJobs>>[number];

/** Load all printers ordered by name */
async function loadPrinters() {
  return db.select().from(schema.printers).orderBy(asc(schema.printers.name)).all();
}

/** Load pending job counts per printer */
async function pendingCountsByPrinter(): Promise<Map<string, number>> {
  const rows = await db
    .select({ printerId: schema.printJobs.printerId })
    .from(schema.printJobs)
    .where(eq(schema.printJobs.status, 'PENDING'))
    .all();
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.printerId, (map.get(r.printerId) ?? 0) + 1);
  }
  return map;
}

/** Serialize printer for API */
const serializePrinter = (printer: any, pending: number) => ({
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

/** Load jobs (used for pending counts) */
async function loadJobs() {
  return db.select().from(schema.printJobs).all();
}

/** Serialize job for API */
const serializeJob = (job: any) => ({
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

/** Ensure only one printer has printsBill = true */
async function applyPrintsBill(printerId: string, value: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    if (value) {
      const holders = await tx
        .select()
        .from(schema.printers)
        .where(eq(schema.printers.printsBill, true))
        .all();
      for (const holder of holders) {
        if (holder.id !== printerId) {
          await tx.update(schema.printers).set({ printsBill: false }).where(eq(schema.printers.id, holder.id));
        }
      }
    }
    await tx.update(schema.printers).set({ printsBill: value }).where(eq(schema.printers.id, printerId));
  });
}

export const printRoutes = new Hono();

// ---------------------------------------------------------------------------
// Impressoras
// ---------------------------------------------------------------------------

printRoutes.get('/printers', requireAuth, async (c) => {
  const [printers, counts] = await Promise.all([loadPrinters(), pendingCountsByPrinter()]);
  return c.json({ printers: printers.map((p) => serializePrinter(p, counts.get(p.id) ?? 0)) });
});

printRoutes.post('/printers', requireAdmin(), async (c) => {
  const body = await parseBody(c, createPrinterSchema);
  const [printer] = await db
    .insert(schema.printers)
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

  if (body.printsBill) await applyPrintsBill(printer.id, true);

  return c.json({ printer: serializePrinter(printer, 0) }, 201);
});

/** Attach printer to an agent (discover) */
printRoutes.post('/printers/:id/attach', requireRole('ADMIN', 'CHEF'), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, attachSchema);

  const printerRows = await db.select().from(schema.printers).where(eq(schema.printers.id, id)).limit(1);
  const printer = printerRows[0];
  if (!printer) throw notFound('Impressora não encontrada');

  if (printer.agentId && printer.agentId !== body.agentId) {
    throw conflict(`Impressora já atrelada a outro agente (${printer.agentName ?? 'desconhecido'})`);
  }

  const baud = body.transport === 'USB' ? body.baud ?? 9600 : null;

  const [updated] = await db
    .update(schema.printers)
    .set({
      address: body.address.trim(),
      transport: body.transport,
      baud,
      agentId: body.agentId,
      agentName: body.agentName,
      boundAt: new Date(),
    })
    .where(eq(schema.printers.id, id))
    .returning();

  const counts = await pendingCountsByPrinter();
  return c.json({ printer: serializePrinter(updated, counts.get(id) ?? 0) });
});

/** Detach printer from agent */
printRoutes.post('/printers/:id/detach', requireAuth, async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, detachSchema);

  const printerRows = await db.select().from(schema.printers).where(eq(schema.printers.id, id)).limit(1);
  const printer = printerRows[0];
  if (!printer) throw notFound('Impressora não encontrada');

  const user = c.get('user');
  if (user.role !== 'ADMIN' && printer.agentId && printer.agentId !== body.agentId) {
    throw forbidden('Impressora atrelada a outro agente');
  }

  if (!printer.agentId) {
    return c.json({ printer: serializePrinter(printer, 0), alreadyDetached: true });
  }

  const [updated] = await db
    .update(schema.printers)
    .set({ agentId: null, agentName: null, baud: null, boundAt: null })
    .where(eq(schema.printers.id, id))
    .returning();

  const counts = await pendingCountsByPrinter();
  return c.json({ printer: serializePrinter(updated, counts.get(id) ?? 0) });
});

/** Patch printer */
printRoutes.patch('/printers/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, updatePrinterSchema);

  const printerRows = await db.select().from(schema.printers).where(eq(schema.printers.id, id)).limit(1);
  const existing = printerRows[0];
  if (!existing) throw notFound('Impressora não encontrada');

  const patch: any = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.address !== undefined) patch.address = body.address.trim();
  if (body.transport !== undefined) patch.transport = body.transport;
  if (body.columns !== undefined) patch.columns = body.columns;
  if (body.codepage !== undefined) patch.codepage = body.codepage;
  if (body.active !== undefined) patch.active = body.active;

  const [printer] = Object.keys(patch).length > 0
    ? await db.update(schema.printers).set(patch).where(eq(schema.printers.id, id)).returning()
    : [existing];

  if (body.printsBill !== undefined) await applyPrintsBill(id, body.printsBill);

  const counts = await pendingCountsByPrinter();
  return c.json({ printer: serializePrinter(printer, counts.get(id) ?? 0) });
});

/** Delete printer */
printRoutes.delete('/printers/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);

  const printerRows = await db.select().from(schema.printers).where(eq(schema.printers.id, id)).limit(1);
  const printer = printerRows[0];
  if (!printer) throw notFound('Impressora não encontrada');

  const activeJobs = await db
    .select()
    .from(schema.printJobs)
    .where(and(eq(schema.printJobs.printerId, id), inArray(schema.printJobs.status, ['PENDING', 'PRINTING'])))
    .all();
  if (activeJobs.length > 0) throw conflict('Impressora tem jobs na fila; espere terminar ou cancele-os');

  await db.delete(schema.printers).where(eq(schema.printers.id, id));
  return c.json({ deleted: true });
});

/** Test printer */
printRoutes.post('/printers/:id/test', requireRole('ADMIN', 'CHEF'), async (c) => {
  const { id } = parseParams(c, idParam);
  const printerRows = await db.select().from(schema.printers).where(eq(schema.printers.id, id)).limit(1);
  const printer = printerRows[0];
  if (!printer) throw notFound('Impressora não encontrada');
  if (!printer.active) throw conflict('Impressora está inativa');

  const jobId = await enqueueJob(db, {
    printerId: printer.id,
    kind: 'TEST',
    payload: testTicket(printer.name, printer.columns),
  });

  return c.json({ jobId }, 201);
});

/** Queue of a printer */
printRoutes.get('/printers/:id/queue', requireAuth, async (c) => {
  const { id } = parseParams(c, idParam);
  const query = parseQuery(c, queueQuery);

  const printerRows = await db.select().from(schema.printers).where(eq(schema.printers.id, id)).limit(1);
  const printer = printerRows[0];
  if (!printer) throw notFound('Impressora não encontrada');

  let base = db.select().from(schema.printJobs).where(eq(schema.printJobs.printerId, id));
  if (query.status) base = base.where(eq(schema.printJobs.status, query.status));
  const jobs = await base.orderBy(desc(schema.printJobs.createdAt)).limit(query.limit ?? QUEUE_DEFAULT).all();

  return c.json({ printer: serializePrinter(printer, 0), jobs: jobs.map(serializeJob) });
});

// ---------------------------------------------------------------------------
// Rotas de impressão (produto ou categoria -> impressora)
// ---------------------------------------------------------------------------

/** List all print routes with printer and target info */
printRoutes.get('/print-routes', requireAuth, async (c) => {
  const rows = await db
    .select()
    .from(schema.printRoutes)
    .leftJoin(schema.printers, eq(schema.printers.id, schema.printRoutes.printerId))
    .leftJoin(schema.products, eq(schema.products.id, schema.printRoutes.productId))
    .leftJoin(schema.categories, eq(schema.categories.id, schema.printRoutes.categoryId))
    .orderBy(desc(schema.printRoutes.createdAt))
    .all();

  const routes = rows.map((row) => ({
    id: row.printRoutes.id,
    priority: row.printRoutes.priority,
    createdAt: row.printRoutes.createdAt,
    printer: { id: row.printers.id, name: row.printers.name },
    target: row.products?.id
      ? { scope: 'PRODUCT' as const, id: row.products.id, name: row.products.name }
      : { scope: 'CATEGORY' as const, id: row.categories?.id ?? '', name: row.categories?.name ?? '' },
    productId: row.printRoutes.productId,
    categoryId: row.printRoutes.categoryId,
  }));

  return c.json({ routes });
});

/** Create a new print route */
printRoutes.post('/print-routes', requireAdmin(), async (c) => {
  const body = await parseBody(c, createRouteSchema);

  const printerRows = await db.select().from(schema.printers).where(eq(schema.printers.id, body.printerId)).limit(1);
  const printer = printerRows[0];
  if (!printer) throw notFound('Impressora não encontrada');

  if (body.productId) {
    const productRows = await db.select().from(schema.products).where(eq(schema.products.id, body.productId)).limit(1);
    const product = productRows[0];
    if (!product) throw notFound('Produto não encontrado');

    const dup = await db
      .select()
      .from(schema.printRoutes)
      .where(and(eq(schema.printRoutes.printerId, printer.id), eq(schema.printRoutes.productId, body.productId)))
      .first();
    if (dup) throw conflict('Já existe rota deste produto para esta impressora');

    const [route] = await db
      .insert(schema.printRoutes)
      .values({
        printerId: printer.id,
        productId: body.productId,
        categoryId: null,
        priority: body.priority ?? 0,
      })
      .returning();
    return c.json({ route: { id: route.id, productId: route.productId, categoryId: route.categoryId } }, 201);
  }

  // Category path
  const categoryRows = await db.select().from(schema.categories).where(eq(schema.categories.id, body.categoryId)).limit(1);
  const category = categoryRows[0];
  if (!category) throw notFound('Categoria não encontrada');

  const dup = await db
    .select()
    .from(schema.printRoutes)
    .where(and(eq(schema.printRoutes.printerId, printer.id), eq(schema.printRoutes.categoryId, body.categoryId)))
    .first();
  if (dup) throw conflict('Já existe rota desta categoria para esta impressora');

  const [route] = await db
    .insert(schema.printRoutes)
    .values({
      printerId: printer.id,
      categoryId: body.categoryId,
      productId: null,
      priority: body.priority ?? 0,
    })
    .returning();
  return c.json({ route: { id: route.id, productId: route.productId, categoryId: route.categoryId } }, 201);
});

/** Delete a print route */
printRoutes.delete('/print-routes/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const routeRows = await db.select().from(schema.printRoutes).where(eq(schema.printRoutes.id, id)).limit(1);
  const route = routeRows[0];
  if (!route) throw notFound('Rota não encontrada');
  await db.delete(schema.printRoutes).where(eq(schema.printRoutes.id, id));
  return c.json({ deleted: true });
});
