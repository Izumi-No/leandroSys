import { conflict, notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import { db } from '../../prisma/db';
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

async function openComandas() {
  const comandas = await db
    .selectFrom('Comanda')
    .where('status', '!=', 'CLOSED')
    .selectAll()
    .execute();
  return comandas;
}

export async function listTables() {
  const [tables, comandas] = await Promise.all([
    db.selectFrom('Table').orderBy('number', 'asc').selectAll().execute(),
    openComandas(),
  ]);

  const byTable = new Map(comandas.map((c) => [c.tableId, c]));

  return tables.map((table) => {
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

export async function createTable(input: CreateTableInput): Promise<string> {
  const table = await db
    .insertInto('Table')
    .values({
      number: input.number,
      capacity: input.capacity ?? 4,
      label: input.label ?? null,
      status: 'AVAILABLE',
    })
    .returning('id')
    .executeTakeFirst();
  if (!table) throw new Error('Failed to create table');
  return table.id;
}

export async function updateTable(tableId: string, input: UpdateTableInput): Promise<void> {
  const table = await db.selectFrom('Table').where('id', '=', tableId).executeTakeFirst();
  if (!table) throw notFound('Mesa não encontrada');

  const patch: Record<string, unknown> = {};
  if (input.number !== undefined) patch.number = input.number;
  if (input.capacity !== undefined) patch.capacity = input.capacity;
  if (input.label !== undefined) patch.label = input.label;
  if (Object.keys(patch).length === 0) return;

  await db.updateTable('Table').where('id', '=', tableId).set(patch).execute();
}

export async function deleteTable(tableId: string): Promise<void> {
  const table = await db.selectFrom('Table').where('id', '=', tableId).executeTakeFirst();
  if (!table) throw notFound('Mesa não encontrada');

  const comandas = await db
    .selectFrom('Comanda')
    .where('tableId', '=', tableId)
    .execute();
  if (comandas.length > 0) throw conflict('Mesa possui comandas vinculadas e não pode ser apagada');

  await db.deleteFrom('Table').where('id', '=', tableId).execute();
}

export async function takeTable(tableId: string, waiterId?: string | null): Promise<string> {
  return openComanda({ tableId, waiterId });
}

export type TransferResult = { from: string; to: string };

export async function transferComanda(comandaId: string, toTableId: string): Promise<TransferResult> {
  const preview = await db.selectFrom('Comanda').selectAll().where('id', '=', comandaId).executeTakeFirst();
  if (!preview) throw notFound('Comanda não encontrada');
  if (preview.status === 'CLOSED') throw conflict('Comanda já foi fechada');
  if (preview.tableId === toTableId) throw conflict('Mesa de destino é a mesma da origem');

  return db.transaction().execute(async (tx) => {
    const fromTableId = preview.tableId;
    const [firstId, secondId] = [fromTableId, toTableId].sort();

    const first = await tx.selectFrom('Table').selectAll().where('id', '=', firstId).executeTakeFirst();
    const second = await tx.selectFrom('Table').selectAll().where('id', '=', secondId).executeTakeFirst();
    if (!first || !second) throw notFound('Mesa não encontrada');
    if (second.status !== 'AVAILABLE') throw conflict('Mesa de destino não está disponível');

    const comanda = await tx.selectFrom('Comanda').selectAll().where('id', '=', comandaId).executeTakeFirst();
    if (!comanda || comanda.status === 'CLOSED') throw conflict('Comanda não está mais ativa');
    if (comanda.tableId === toTableId) throw conflict('Mesa de destino é a mesma da origem');

    const origin = comanda.tableId;
    await tx.updateTable('Comanda').where('id', '=', comandaId).set({ tableId: toTableId }).execute();
    await tx.updateTable('Table').where('id', '=', origin).set({ status: 'AVAILABLE' }).execute();
    await tx.updateTable('Table').where('id', '=', toTableId).set({ status: 'OCCUPIED' }).execute();

    return { from: origin, to: toTableId };
  });
}

export async function reserveTable(tableId: string): Promise<void> {
  const table = await db.selectFrom('Table').selectAll().where('id', '=', tableId).executeTakeFirst();
  if (!table) throw notFound('Mesa não encontrada');
  if (table.status === 'OCCUPIED') throw conflict('Mesa está ocupada');
  if (table.status === 'RESERVED') throw conflict('Mesa já está reservada');

  await db.updateTable('Table').where('id', '=', tableId).set({ status: 'RESERVED' }).execute();
}

export async function cancelReservation(tableId: string): Promise<void> {
  const table = await db.selectFrom('Table').selectAll().where('id', '=', tableId).executeTakeFirst();
  if (!table) throw notFound('Mesa não encontrada');
  if (table.status === 'OCCUPIED') throw conflict('Mesa está ocupada; feche a comanda para liberar');

  await db.updateTable('Table').where('id', '=', tableId).set({ status: 'AVAILABLE' }).execute();
}

export async function releaseTable(
  tableId: string,
  paymentMethod?: PaymentMethod,
): Promise<{ comandaId: string; warnings: string[] }> {
  const table = await db.selectFrom('Table').selectAll().where('id', '=', tableId).executeTakeFirst();
  if (!table) throw notFound('Mesa não encontrada');
  if (table.status === 'AVAILABLE') throw conflict('Mesa já está livre');

  const comanda = await db
    .selectFrom('Comanda')
    .selectAll()
    .where('tableId', '=', tableId)
    .where('status', '!=', 'CLOSED')
    .executeTakeFirst();

  if (!comanda) {
    await db.updateTable('Table').where('id', '=', tableId).set({ status: 'AVAILABLE' }).execute();
    return { comandaId: '', warnings: ['Mesa liberada (nenhuma comanda em aberto)'] };
  }

  const result = await closeComanda(comanda.id, paymentMethod);
  return { comandaId: comanda.id, warnings: result.warnings };
}