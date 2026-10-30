import { and, asc, eq, ne } from 'drizzle-orm';
import { conflict, notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import type { AppDb, DbLike } from '../../db';
import { comandas, diningTables } from '../../db/schema';
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

async function openComandas(db: DbLike) {
  return db.select().from(comandas).where(ne(comandas.status, 'CLOSED'));
}

export async function listTables(db: DbLike) {
  const [tableRows, openRows] = await Promise.all([
    db.select().from(diningTables).orderBy(asc(diningTables.number)),
    openComandas(db),
  ]);

  const byTable = new Map(openRows.map((comanda) => [comanda.tableId, comanda]));

  return tableRows.map((table) => {
    const comanda = byTable.get(table.id);
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
            waiter: null,
            total: money(comanda.total),
            itemCount: 0,
            pendingItems: 0,
          }
        : null,
    };
  });
}

export async function createTable(db: DbLike, input: CreateTableInput): Promise<string> {
  const [table] = await db
    .insert(diningTables)
    .values({
      number: input.number,
      capacity: input.capacity ?? 4,
      label: input.label ?? null,
      status: 'AVAILABLE',
    })
    .returning({ id: diningTables.id });
  if (!table) throw new Error('Failed to create table');
  return table.id;
}

export async function updateTable(db: DbLike, tableId: string, input: UpdateTableInput): Promise<void> {
  const [table] = await db.select().from(diningTables).where(eq(diningTables.id, tableId)).limit(1);
  if (!table) throw notFound('Mesa não encontrada');

  const patch: Partial<typeof diningTables.$inferInsert> = {};
  if (input.number !== undefined) patch.number = input.number;
  if (input.capacity !== undefined) patch.capacity = input.capacity;
  if (input.label !== undefined) patch.label = input.label;
  if (Object.keys(patch).length === 0) return;

  await db.update(diningTables).set(patch).where(eq(diningTables.id, tableId));
}

export async function deleteTable(db: DbLike, tableId: string): Promise<void> {
  const [table] = await db.select().from(diningTables).where(eq(diningTables.id, tableId)).limit(1);
  if (!table) throw notFound('Mesa não encontrada');

  const linkedComandas = await db.select({ id: comandas.id }).from(comandas).where(eq(comandas.tableId, tableId));
  if (linkedComandas.length > 0) throw conflict('Mesa possui comandas vinculadas e não pode ser apagada');

  await db.delete(diningTables).where(eq(diningTables.id, tableId));
}

export async function takeTable(db: AppDb, tableId: string, waiterId?: string | null): Promise<string> {
  return openComanda(db, { tableId, waiterId });
}

export type TransferResult = { from: string; to: string };

export async function transferComanda(db: AppDb, comandaId: string, toTableId: string): Promise<TransferResult> {
  const [preview] = await db.select().from(comandas).where(eq(comandas.id, comandaId)).limit(1);
  if (!preview) throw notFound('Comanda não encontrada');
  if (preview.status === 'CLOSED') throw conflict('Comanda já foi fechada');
  if (preview.tableId === toTableId) throw conflict('Mesa de destino é a mesma da origem');

  return db.transaction(async (tx) => {
    const fromTableId = preview.tableId;
    const [firstId, secondId] = [fromTableId, toTableId].sort();

    const [first] = await tx.select().from(diningTables).where(eq(diningTables.id, firstId)).limit(1);
    const [second] = await tx.select().from(diningTables).where(eq(diningTables.id, secondId)).limit(1);
    if (!first || !second) throw notFound('Mesa não encontrada');
    if (second.status !== 'AVAILABLE') throw conflict('Mesa de destino não está disponível');

    const [comanda] = await tx.select().from(comandas).where(eq(comandas.id, comandaId)).limit(1);
    if (!comanda || comanda.status === 'CLOSED') throw conflict('Comanda não está mais ativa');
    if (comanda.tableId === toTableId) throw conflict('Mesa de destino é a mesma da origem');

    const origin = comanda.tableId;
    await tx.update(comandas).set({ tableId: toTableId }).where(eq(comandas.id, comandaId));
    await tx.update(diningTables).set({ status: 'AVAILABLE' }).where(eq(diningTables.id, origin));
    await tx.update(diningTables).set({ status: 'OCCUPIED' }).where(eq(diningTables.id, toTableId));

    return { from: origin, to: toTableId };
  });
}

export async function reserveTable(db: DbLike, tableId: string): Promise<void> {
  const [table] = await db.select().from(diningTables).where(eq(diningTables.id, tableId)).limit(1);
  if (!table) throw notFound('Mesa não encontrada');
  if (table.status === 'OCCUPIED') throw conflict('Mesa está ocupada');
  if (table.status === 'RESERVED') throw conflict('Mesa já está reservada');

  await db.update(diningTables).set({ status: 'RESERVED' }).where(eq(diningTables.id, tableId));
}

export async function cancelReservation(db: DbLike, tableId: string): Promise<void> {
  const [table] = await db.select().from(diningTables).where(eq(diningTables.id, tableId)).limit(1);
  if (!table) throw notFound('Mesa não encontrada');
  if (table.status === 'OCCUPIED') throw conflict('Mesa está ocupada; feche a comanda para liberar');

  await db.update(diningTables).set({ status: 'AVAILABLE' }).where(eq(diningTables.id, tableId));
}

export async function releaseTable(
  db: AppDb,
  tableId: string,
  paymentMethod?: PaymentMethod,
): Promise<{ comandaId: string; warnings: string[] }> {
  const [table] = await db.select().from(diningTables).where(eq(diningTables.id, tableId)).limit(1);
  if (!table) throw notFound('Mesa não encontrada');
  if (table.status === 'AVAILABLE') throw conflict('Mesa já está livre');

  const [comanda] = await db
    .select()
    .from(comandas)
    .where(and(eq(comandas.tableId, tableId), ne(comandas.status, 'CLOSED')))
    .limit(1);

  if (!comanda) {
    await db.update(diningTables).set({ status: 'AVAILABLE' }).where(eq(diningTables.id, tableId));
    return { comandaId: '', warnings: ['Mesa liberada (nenhuma comanda em aberto)'] };
  }

  const result = await closeComanda(db, comanda.id, paymentMethod);
  return { comandaId: comanda.id, warnings: result.warnings };
}
