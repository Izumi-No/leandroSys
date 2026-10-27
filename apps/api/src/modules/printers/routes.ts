import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin, requireAuth, requireRole } from '../../lib/auth';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { parseBody, parseParams, parseQuery } from '../../lib/validate';
import { db } from '../../prisma/db';
import { renderTicketBase64, type TicketDoc } from '../printing/escpos';
import { enqueueJob } from '../printing/queue';
import { testTicket } from '../printing/tickets';

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

const claimSchema = z.object({
  printerId: z.uuid(),
  agentId: z.string().min(6).max(64),
  limit: z.number().int().min(1).max(32).optional(),
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

async function loadPrinters() {
  return db.orm.public.Printer.orderBy((printer) => printer.name.asc()).all();
}

async function pendingCountsByPrinter(): Promise<Map<string, number>> {
  const rows = await db.orm.public.PrintJob.where({ status: 'PENDING' }).select('printerId').all();
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
async function applyPrintsBill(printerId: string, value: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    if (value) {
      const holders = await tx.orm.public.Printer.where((printer) => printer.printsBill.eq(true)).all();
      for (const holder of holders) {
        if (holder.id !== printerId) {
          await tx.orm.public.Printer.where({ id: holder.id }).update({ printsBill: false });
        }
      }
    }
    await tx.orm.public.Printer.where({ id: printerId }).update({ printsBill: value });
  });
}

export const printRoutes = new Hono();

// ---------------------------------------------------------------------------
// Impressoras
// ---------------------------------------------------------------------------

printRoutes.get('/printers', requireAuth, async (c) => {
  const [printers, counts] = await Promise.all([loadPrinters(), pendingCountsByPrinter()]);
  return c.json({
    printers: printers.map((printer) => serializePrinter(printer, counts.get(printer.id) ?? 0)),
  });
});

printRoutes.post('/printers', requireAdmin(), async (c) => {
  const body = await parseBody(c, createPrinterSchema);

  const printer = await db.orm.public.Printer.create({
    name: body.name,
    address: body.address?.trim() ?? '',
    transport: body.transport ?? 'BLUETOOTH',
    columns: body.columns ?? 32,
    codepage: body.codepage ?? 19,
    active: body.active ?? true,
    printsBill: false,
  });

  if (body.printsBill) await applyPrintsBill(printer.id, true);

  return c.json({ printer: serializePrinter(printer, 0) }, 201);
});

/**
 * Atrela uma fila já cadastrada a um dispositivo local descoberto pelo printd.
 * Não cria impressora: o cadastro da fila continua sendo do admin.
 */
printRoutes.post('/printers/:id/attach', requireRole('ADMIN', 'CHEF'), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, attachSchema);

  const printer = await db.orm.public.Printer.first({ id });
  if (!printer) throw notFound('Impressora não encontrada');

  if (printer.agentId && printer.agentId !== body.agentId) {
    throw conflict(`Impressora já atrelada a outro agente (${printer.agentName ?? 'desconhecido'})`);
  }

  const baud = body.transport === 'USB' ? (body.baud ?? 9600) : null;
  const atualizada = await db.orm.public.Printer.where({ id }).update({
    address: body.address.trim(),
    transport: body.transport,
    baud,
    agentId: body.agentId,
    agentName: body.agentName,
    boundAt: new Date(),
  });
  if (!atualizada) throw notFound('Impressora não encontrada');

  const counts = await pendingCountsByPrinter();
  return c.json({ printer: serializePrinter(atualizada, counts.get(id) ?? 0) });
});

/** Libera a fila para outro agente. A fila, rotas e histórico são preservados. */
printRoutes.post('/printers/:id/detach', requireAuth, async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, detachSchema);

  const printer = await db.orm.public.Printer.first({ id });
  if (!printer) throw notFound('Impressora não encontrada');

  const usuario = c.get('user');
  if (usuario.role !== 'ADMIN' && printer.agentId && printer.agentId !== body.agentId) {
    throw forbidden('Impressora atrelada a outro agente');
  }
  if (!printer.agentId) {
    return c.json({ printer: serializePrinter(printer, 0), alreadyDetached: true });
  }

  const atualizada = await db.orm.public.Printer.where({ id }).update({
    agentId: null,
    agentName: null,
    baud: null,
    boundAt: null,
  });
  if (!atualizada) throw notFound('Impressora não encontrada');

  const counts = await pendingCountsByPrinter();
  return c.json({ printer: serializePrinter(atualizada, counts.get(id) ?? 0) });
});

printRoutes.patch('/printers/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, updatePrinterSchema);

  const existing = await db.orm.public.Printer.first({ id });
  if (!existing) throw notFound('Impressora não encontrada');

  const patch: {
    name?: string;
    address?: string;
    transport?: 'BLUETOOTH' | 'USB' | 'NETWORK';
    columns?: number;
    codepage?: number;
    active?: boolean;
  } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.address !== undefined) patch.address = body.address.trim();
  if (body.transport !== undefined) patch.transport = body.transport;
  if (body.columns !== undefined) patch.columns = body.columns;
  if (body.codepage !== undefined) patch.codepage = body.codepage;
  if (body.active !== undefined) patch.active = body.active;

  const printer = Object.keys(patch).length > 0 ? await db.orm.public.Printer.where({ id }).update(patch) : existing;
  if (!printer) throw notFound('Impressora não encontrada');

  if (body.printsBill !== undefined) await applyPrintsBill(id, body.printsBill);

  const counts = await pendingCountsByPrinter();
  return c.json({ printer: serializePrinter(printer, counts.get(id) ?? 0) });
});

printRoutes.delete('/printers/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);

  const printer = await db.orm.public.Printer.first({ id });
  if (!printer) throw notFound('Impressora não encontrada');

  const activeJobs = await db.orm.public.PrintJob
    .where({ printerId: id })
    .where((job) => job.status.in(['PENDING', 'PRINTING']))
    .all();
  if (activeJobs.length > 0) throw conflict('Impressora tem jobs na fila; espere terminar ou cancele-os');

  await db.orm.public.Printer.where({ id }).delete();
  return c.json({ deleted: true });
});

printRoutes.post('/printers/:id/test', requireRole('ADMIN', 'CHEF'), async (c) => {
  const { id } = parseParams(c, idParam);

  const printer = await db.orm.public.Printer.first({ id });
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
  const { id } = parseParams(c, idParam);
  const query = parseQuery(c, queueQuery);

  const printer = await db.orm.public.Printer.first({ id });
  if (!printer) throw notFound('Impressora não encontrada');

  const base = db.orm.public.PrintJob.where({ printerId: id });
  const jobs = await (query.status ? base.where({ status: query.status }) : base)
    .orderBy((job) => job.createdAt.desc())
    .limit(query.limit ?? QUEUE_DEFAULT)
    .all();

  return c.json({ printer: serializePrinter(printer, 0), jobs: jobs.map(serializeJob) });
});

// ---------------------------------------------------------------------------
// Rotas de impressão (produto ou categoria -> impressora)
// ---------------------------------------------------------------------------

printRoutes.get('/print-routes', requireAuth, async (c) => {
  const routes = await db.orm.public.PrintRoute
    .orderBy((route) => route.createdAt.desc())
    .include('printer')
    .include('product')
    .include('category')
    .all();

  return c.json({
    routes: routes.map((route) => ({
      id: route.id,
      priority: route.priority,
      createdAt: route.createdAt,
      printer: { id: route.printer.id, name: route.printer.name },
      target: route.product
        ? { scope: 'PRODUCT' as const, id: route.product.id, name: route.product.name }
        : { scope: 'CATEGORY' as const, id: route.category?.id ?? '', name: route.category?.name ?? '' },
      productId: route.productId,
      categoryId: route.categoryId,
    })),
  });
});

printRoutes.post('/print-routes', requireAdmin(), async (c) => {
  const body = await parseBody(c, createRouteSchema);

  const printer = await db.orm.public.Printer.first({ id: body.printerId });
  if (!printer) throw notFound('Impressora não encontrada');

  if (body.productId) {
    const product = await db.orm.public.Product.first({ id: body.productId });
    if (!product) throw notFound('Produto não encontrado');

    const duplicate = await db.orm.public.PrintRoute
      .where({ printerId: printer.id, productId: body.productId })
      .first();
    if (duplicate) throw conflict('Já existe rota deste produto para esta impressora');

    const route = await db.orm.public.PrintRoute.create({
      printerId: printer.id,
      productId: body.productId,
      categoryId: null,
      priority: body.priority ?? 0,
    });
    return c.json({ route: { id: route.id, productId: route.productId, categoryId: route.categoryId } }, 201);
  }

  const category = await db.orm.public.Category.first({ id: body.categoryId });
  if (!category) throw notFound('Categoria não encontrada');

  const duplicate = await db.orm.public.PrintRoute
    .where({ printerId: printer.id, categoryId: body.categoryId })
    .first();
  if (duplicate) throw conflict('Já existe rota desta categoria para esta impressora');

  const route = await db.orm.public.PrintRoute.create({
    printerId: printer.id,
    categoryId: body.categoryId,
    productId: null,
    priority: body.priority ?? 0,
  });
  return c.json({ route: { id: route.id, productId: route.productId, categoryId: route.categoryId } }, 201);
});

printRoutes.delete('/print-routes/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);

  const route = await db.orm.public.PrintRoute.first({ id });
  if (!route) throw notFound('Rota não encontrada');

  await db.orm.public.PrintRoute.where({ id }).delete();
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Fila de jobs
// ---------------------------------------------------------------------------

printRoutes.get('/print-jobs', requireAuth, async (c) => {
  const query = parseQuery(c, jobsQuery);

  let base = db.orm.public.PrintJob;
  if (query.printerId) base = base.where({ printerId: query.printerId });
  if (query.status) base = base.where({ status: query.status });

  const jobs = await base
    .orderBy((job) => job.createdAt.desc())
    .limit(query.limit ?? QUEUE_DEFAULT)
    .all();

  return c.json({ jobs: jobs.map(serializeJob) });
});

/**
 * O cliente (Electron) "pega" jobs da fila: PENDING -> PRINTING e devolve os
 * bytes ESC/POS prontos. Jobs abandonados há 5min voltam para PENDING.
 */
printRoutes.post('/print-jobs/claim', requireAuth, async (c) => {
  const body = await parseBody(c, claimSchema);

  const printer = await db.orm.public.Printer.first({ id: body.printerId });
  if (!printer) throw notFound('Impressora não encontrada');
  if (!printer.active) throw conflict('Impressora está inativa');
  if (!printer.agentId) throw conflict('Impressora não está atrelada a nenhum agente');
  if (printer.agentId !== body.agentId) throw conflict('Impressora atrelada a outro agente');

  const staleCutoff = new Date(Date.now() - STALE_MS);

  const claimed = await db.transaction(async (tx) => {
    const stale = await tx.orm.public.PrintJob
      .where({ printerId: printer.id })
      .where((job) => job.status.eq('PRINTING'))
      .where((job) => job.claimedAt.lt(staleCutoff))
      .all();

    for (const job of stale) {
      await tx.orm.public.PrintJob.where({ id: job.id }).update({ status: 'PENDING', claimedAt: null });
    }

    const jobs = await tx.orm.public.PrintJob
      .where({ printerId: printer.id })
      .where((job) => job.status.eq('PENDING'))
      .orderBy((job) => job.createdAt.asc())
      .limit(body.limit ?? CLAIM_DEFAULT)
      .forUpdate({ skipLocked: true })
      .all();

    const rows = [];
    for (const job of jobs) {
      const updated = await tx.orm.public.PrintJob.where({ id: job.id }).update({
        status: 'PRINTING',
        attempts: job.attempts + 1,
        claimedAt: new Date(),
      });
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
    data: renderTicketBase64(job.payload as unknown as TicketDoc, {
      columns: printer.columns,
      codepage: printer.codepage,
    }),
  }));

  return c.json({ jobs });
});

/** Resultado do envio físico: sucesso finaliza; erro tenta de novo ou falha. */
printRoutes.post('/print-jobs/:id/ack', requireAuth, async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, ackSchema);

  const job = await db.orm.public.PrintJob.first({ id });
  if (!job) throw notFound('Job não encontrado');
  if (job.status === 'DONE' || job.status === 'CANCELED') {
    return c.json({ id, status: job.status, alreadyFinished: true });
  }
  // Ack atrasado: o job já saiu de PRINTING (voltou para a fila por timeout ou
  // falha anterior) — pode já estar com outro cliente, então não aplicamos.
  if (job.status === 'PENDING') throw conflict('Job não está em impressão');

  if (body.success) {
    await db.orm.public.PrintJob.where({ id }).update({
      status: 'DONE',
      finishedAt: new Date(),
      lastError: null,
    });
    return c.json({ id, status: 'DONE', attempts: job.attempts });
  }

  const lastError = (body.error ?? 'Falha desconhecida').slice(0, 500);

  if (job.status === 'FAILED' || job.attempts >= MAX_ATTEMPTS) {
    await db.orm.public.PrintJob.where({ id }).update({
      status: 'FAILED',
      lastError,
      finishedAt: new Date(),
    });
    return c.json({ id, status: 'FAILED', attempts: job.attempts });
  }

  await db.orm.public.PrintJob.where({ id }).update({ status: 'PENDING', lastError, claimedAt: null });
  return c.json({ id, status: 'PENDING', attempts: job.attempts });
});

/** Devolve um job FAILED/CANCELED para a fila. */
printRoutes.post('/print-jobs/:id/retry', requireAuth, async (c) => {
  const { id } = parseParams(c, idParam);

  const job = await db.orm.public.PrintJob.first({ id });
  if (!job) throw notFound('Job não encontrado');
  if (job.status === 'DONE') throw conflict('Job já foi impresso');
  if (job.status === 'PENDING' || job.status === 'PRINTING') throw badRequest('Job já está na fila');

  await db.orm.public.PrintJob.where({ id }).update({
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    claimedAt: null,
    finishedAt: null,
  });
  return c.json({ id, status: 'PENDING' });
});

printRoutes.post('/print-jobs/:id/cancel', requireAuth, async (c) => {
  const { id } = parseParams(c, idParam);

  const job = await db.orm.public.PrintJob.first({ id });
  if (!job) throw notFound('Job não encontrado');
  if (job.status === 'DONE') throw conflict('Job já foi impresso');

  await db.orm.public.PrintJob.where({ id }).update({
    status: 'CANCELED',
    finishedAt: new Date(),
  });
  return c.json({ id, status: 'CANCELED' });
});
