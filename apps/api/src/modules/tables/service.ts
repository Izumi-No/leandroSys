import { conflict, notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import { db } from '../../infrastructure/drizzle/db';
import { schema } from '../../infrastructure/drizzle/schema';
import { eq, asc, desc, and, inArray, neq } from 'drizzle-orm';
import { closeComanda, openComanda, type PaymentMethod } from '../comandas/service';

export type CreateTableInput = {
  number: number;
  capacity?: number;
  label?: string | null;
};

export type UpdateTableInput = {
  number?: number;
  capacity?: number;
  label?: string | null;
};

type OpenComandaRow = Awaited<ReturnType<typeof openComandas>>[number];

/** Helper: fetch open comandas (status != CLOSED) with waiter and items (id & status). */
async function openComandas() {
  // Fetch comandas
  const comandaRows = await db
    .select()
    .from(schema.comandas)
    .where(neq(schema.comandas.status, 'CLOSED'))
    .all();

  const comandaIds = comandaRows.map((c) => c.id);

  // Fetch waiters (users) for those comandas
  const waiters = await db
    .select()
    .from(schema.users)
    .where(inArray(schema.users.id, comandaRows.map((c) => (c as any).waiterId).filter(Boolean) as string[]))
    .all();
  const waitersMap = new Map(waiters.map((w) => [w.id, w]));

  // Fetch items (only id & status) for those comandas
  const items = await db
    .select({ id: schema.comandaItems.id, status: schema.comandaItems.status, comandaId: schema.comandaItems.comandaId })
    .from(schema.comandaItems)
    .where(inArray(schema.comandaItems.comandaId, comandaIds)))
    .all();
  const itemsByComanda = new Map<string, any[]>();
  for (const it of items) {
    const arr = itemsByComanda.get(it.comandaId) ?? [];
    arr.push({ id: it.id, status: it.status });
    itemsByComanda.set(it.comandaId, arr);
  }

  // Assemble rows
  return comandaRows.map((c) => ({
    ...c,
    waiter: (c as any).waiterId ? waitersMap.get((c as any).waiterId) ?? null : null,
    items: itemsByComanda.get(c.id) ?? [],
  }));
}

/** Mapa de salão: mesas + comanda em aberto (itens para contagem). */
export async function listTables() {
  const [tables, comandas] = await Promise.all([
    db.select().from(schema.tables).orderBy(asc(schema.tables.number)).all(),
    openComandas(),
  ]);

  const byTable = new Map<string, OpenComandaRow>(comandas.map((c) => [c.tableId, c]));

  return tables.map((table) => {
    const comanda = byTable.get(table.id);
    const items = comanda ? comanda.items.filter((i) => i.status !== 'CANCELED') : [];
    return {
      id: table.id,
      number: table.number,
      capacity: table.capacity,
      label: table.label,
      status: table.status,
      comanda: comanda
        ? {
            id: comanda.id,
            number: comanda.number,
            status: comanda.status,
            openedAt: comanda.openedAt,
            waiter: comanda.waiter
              ? { id: comanda.waiter.id, username: comanda.waiter.username, role: comanda.waiter.role }
              : null,
            total: money(comanda.total),
            itemCount: items.length,
            pendingItems: items.filter((i) => i.status === 'PENDING').length,
          }
        : null,
    };
  });
}

export async function createTable(input: CreateTableInput): Promise<string> {
  const [table] = await db
    .insert(schema.tables)
    .values({
      number: input.number,
      capacity: input.capacity ?? 4,
      label: input.label ?? null,
      status: 'AVAILABLE',
    })
    .returning();
  return table.id;
}

export async function updateTable(tableId: string, input: UpdateTableInput): Promise<void> {
  const existingRows = await db.select().from(schema.tables).where(eq(schema.tables.id, tableId)).limit(1);
  const table = existingRows[0];
  if (!table) throw notFound('Mesa não encontrada');

  const patch: any = {};
  if (input.number !== undefined) patch.number = input.number;
  if (input.capacity !== undefined) patch.capacity = input.capacity;
  if (input.label !== undefined) patch.label = input.label;
  if (Object.keys(patch).length === 0) return;

  await db.update(schema.tables).set(patch).where(eq(schema.tables.id, tableId));
}

/** Só apaga mesa sem histórico de comandas (senão a FK restringe). */
export async function deleteTable(tableId: string): Promise<void> {
  const existingRows = await db.select().from(schema.tables).where(eq(schema.tables.id, tableId)).limit(1);
  const table = existingRows[0];
  if (!table) throw notFound('Mesa não encontrada');

  const comandaRows = await db.select().from(schema.comandas).where(eq(schema.comandas.tableId, tableId)).all();
  if (comandaRows.length > 0) throw conflict('Mesa possui comandas vinculadas e não pode ser apagada');

  await db.delete(schema.tables).where(eq(schema.tables.id, tableId));
}

/** "Pega" a mesa: ocupa e abre a comanda. */
export async function takeTable(tableId: string, waiterId?: string | null): Promise<string> {
  return openComanda({ tableId, waiterId });
}

export type TransferResult = { from: string; to: string };

/** Passa a comanda de uma mesa para outra (mantém itens e histórico). */
export async function transferComanda(comandaId: string, toTableId: string): Promise<TransferResult> {
  const previewRows = await db.select().from(schema.comandas).where(eq(schema.comandas.id, comandaId)).limit(1);
  const preview = previewRows[0];
  if (!preview) throw notFound('Comanda não encontrada');
  if (preview.status === 'CLOSED') throw conflict('Comanda já foi fechada');
  if (preview.tableId === toTableId) throw conflict('Mesa de destino é a mesma da origem');

  return db.transaction(async (tx) => {
    // Lock tables deterministically
    const fromTableId = preview.tableId;
    const [firstId, secondId] = [fromTableId, toTableId].sort();

    const firstRows = await tx.select().from(schema.tables).where(eq(schema.tables.id, firstId)).forUpdate().limit(1);
    const secondRows = await tx.select().from(schema.tables).where(eq(schema.tables.id, secondId)).forUpdate().limit(1);
    const first = firstRows[0];
    const second = secondRows[0];
    if (!first || !second) throw notFound('Mesa não encontrada');
    if (second.status !== 'AVAILABLE') throw conflict('Mesa de destino não está disponível');

    const comandaRows = await tx.select().from(schema.comandas).where(eq(schema.comandas.id, comandaId)).forUpdate().limit(1);
    const comanda = comandaRows[0];
    if (!comanda || comanda.status === 'CLOSED') throw conflict('Comanda não está mais ativa');
    if (comanda.tableId === toTableId) throw conflict('Mesa de destino é a mesma da origem');

    const origin = comanda.tableId;
    await tx.update(schema.comandas).set({ tableId: toTableId }).where(eq(schema.comandas.id, comandaId));
    await tx.update(schema.tables).set({ status: 'AVAILABLE' }).where(eq(schema.tables.id, origin));
    await tx.update(schema.tables).set({ status: 'OCCUPIED' }).where(eq(schema.tables.id, toTableId));

    return { from: origin, to: toTableId };
  });
}

export async function reserveTable(tableId: string): Promise<void> {
  const rows = await db.select().from(schema.tables).where(eq(schema.tables.id, tableId)).forUpdate().limit(1);
  const table = rows[0];
  if (!table) throw notFound('Mesa não encontrada');
  if (table.status === 'OCCUPIED') throw conflict('Mesa está ocupada');
  if (table.status === 'RESERVED') throw conflict('Mesa já está reservada');
  await db.update(schema.tables).set({ status: 'RESERVED' }).where(eq(schema.tables.id, tableId));
}

export async function cancelReservation(tableId: string): Promise<void> {
  const rows = await db.select().from(schema.tables).where(eq(schema.tables.id, tableId)).forUpdate().limit(1);
  const table = rows[0];
  if (!table) throw notFound('Mesa não encontrada');
  if (table.status === 'OCCUPIED') throw conflict('Mesa está ocupada; feche a comanda para liberar');
  await db.update(schema.tables).set({ status: 'AVAILABLE' }).where(eq(schema.tables.id, tableId));
}

/** Libera a mesa fechando a comanda em aberto. */
export async function releaseTable(
  tableId: string,
  paymentMethod?: PaymentMethod,
): Promise<{ comandaId: string; warnings: string[] }> {
  const tableRows = await db.select().from(schema.tables).where(eq(schema.tables.id, tableId)).limit(1);
  const table = tableRows[0];
  if (!table) throw notFound('Mesa não encontrada');
  if (table.status === 'AVAILABLE') throw conflict('Mesa já está livre');

  const comandaRows = await db
    .select()
    .from(schema.comandas)
    .where(and(eq(schema.comandas.tableId, tableId), neq(schema.comandas.status, 'CLOSED')))
    .limit(1);
  const comanda = comandaRows[0];

  if (!comanda) {
    await db.update(schema.tables).set({ status: 'AVAILABLE' }).where(eq(schema.tables.id, tableId));
    return { comandaId: '', warnings: ['Mesa liberada (nenhuma comanda em aberto)'] };
  }

  const result = await closeComanda(comanda.id, paymentMethod);
  return { comandaId: comanda.id, warnings: result.warnings };
}
