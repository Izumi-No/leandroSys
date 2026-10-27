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

type OpenComandaRow = Awaited<ReturnType<typeof openComandas>>[number];

async function openComandas() {
  return db.orm.public.Comanda
    .where((comanda) => comanda.status.neq('CLOSED'))
    .include('waiter')
    .include('items', (items) => items.select('id', 'status'))
    .all();
}

/** Mapa de salão: mesas + comanda em aberto (itens para contagem). */
export async function listTables() {
  const [tables, comandas] = await Promise.all([
    db.orm.public.Table.orderBy((table) => table.number.asc()).all(),
    openComandas(),
  ]);

  const byTable = new Map<string, OpenComandaRow>(comandas.map((comanda) => [comanda.tableId, comanda]));

  return tables.map((table) => {
    const comanda = byTable.get(table.id);
    const items = comanda ? comanda.items.filter((item) => item.status !== 'CANCELED') : [];

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
            pendingItems: items.filter((item) => item.status === 'PENDING').length,
          }
        : null,
    };
  });
}

export async function createTable(input: CreateTableInput): Promise<string> {
  const table = await db.orm.public.Table.create({
    number: input.number,
    capacity: input.capacity ?? 4,
    label: input.label ?? null,
    status: 'AVAILABLE',
  });
  return table.id;
}

export async function updateTable(tableId: string, input: UpdateTableInput): Promise<void> {
  const table = await db.orm.public.Table.first({ id: tableId });
  if (!table) throw notFound('Mesa não encontrada');

  const patch: { number?: number; capacity?: number; label?: string | null } = {};
  if (input.number !== undefined) patch.number = input.number;
  if (input.capacity !== undefined) patch.capacity = input.capacity;
  if (input.label !== undefined) patch.label = input.label;
  if (Object.keys(patch).length === 0) return;

  await db.orm.public.Table.where({ id: tableId }).update(patch);
}

/** Só apaga mesa sem histórico de comandas (senão a FK restringe). */
export async function deleteTable(tableId: string): Promise<void> {
  const table = await db.orm.public.Table.first({ id: tableId });
  if (!table) throw notFound('Mesa não encontrada');

  const comandas = await db.orm.public.Comanda.where({ tableId }).all();
  if (comandas.length > 0) throw conflict('Mesa possui comandas vinculadas e não pode ser apagada');

  await db.orm.public.Table.where({ id: tableId }).delete();
}

/** "Pega" a mesa: ocupa e abre a comanda. */
export async function takeTable(tableId: string, waiterId?: string | null): Promise<string> {
  return openComanda({ tableId, waiterId });
}

export type TransferResult = { from: string; to: string };

/** Passa a comanda de uma mesa para outra (mantém itens e histórico). */
export async function transferComanda(comandaId: string, toTableId: string): Promise<TransferResult> {
  const preview = await db.orm.public.Comanda.first({ id: comandaId });
  if (!preview) throw notFound('Comanda não encontrada');
  if (preview.status === 'CLOSED') throw conflict('Comanda já foi fechada');
  if (preview.tableId === toTableId) throw conflict('Mesa de destino é a mesma da origem');

  return db.transaction(async (tx) => {
    // Trava as duas mesas em ordem determinística para não dar deadlock.
    const fromTableId = preview.tableId;
    const [firstId, secondId] = [fromTableId, toTableId].sort();

    const first = await tx.orm.public.Table.where({ id: firstId }).forUpdate().first();
    const second = await tx.orm.public.Table.where({ id: secondId }).forUpdate().first();
    if (!first || !second) throw notFound('Mesa não encontrada');
    if (second.status !== 'AVAILABLE') throw conflict('Mesa de destino não está disponível');

    const comanda = await tx.orm.public.Comanda.where({ id: comandaId }).forUpdate().first();
    if (!comanda || comanda.status === 'CLOSED') throw conflict('Comanda não está mais ativa');
    if (comanda.tableId === toTableId) throw conflict('Mesa de destino é a mesma da origem');

    const origin = comanda.tableId;
    await tx.orm.public.Comanda.where({ id: comandaId }).update({ tableId: toTableId });
    await tx.orm.public.Table.where({ id: origin }).update({ status: 'AVAILABLE' });
    await tx.orm.public.Table.where({ id: toTableId }).update({ status: 'OCCUPIED' });

    return { from: origin, to: toTableId };
  });
}

export async function reserveTable(tableId: string): Promise<void> {
  const table = await db.orm.public.Table.where({ id: tableId }).forUpdate().first();
  if (!table) throw notFound('Mesa não encontrada');
  if (table.status === 'OCCUPIED') throw conflict('Mesa está ocupada');
  if (table.status === 'RESERVED') throw conflict('Mesa já está reservada');

  await db.orm.public.Table.where({ id: tableId }).update({ status: 'RESERVED' });
}

export async function cancelReservation(tableId: string): Promise<void> {
  const table = await db.orm.public.Table.where({ id: tableId }).forUpdate().first();
  if (!table) throw notFound('Mesa não encontrada');
  if (table.status === 'OCCUPIED') throw conflict('Mesa está ocupada; feche a comanda para liberar');

  await db.orm.public.Table.where({ id: tableId }).update({ status: 'AVAILABLE' });
}

/** Libera a mesa fechando a comanda em aberto. */
export async function releaseTable(
  tableId: string,
  paymentMethod?: PaymentMethod,
): Promise<{ comandaId: string; warnings: string[] }> {
  const table = await db.orm.public.Table.first({ id: tableId });
  if (!table) throw notFound('Mesa não encontrada');
  if (table.status === 'AVAILABLE') throw conflict('Mesa já está livre');

  const comanda = await db.orm.public.Comanda
    .where({ tableId })
    .where((comanda) => comanda.status.neq('CLOSED'))
    .first();

  if (!comanda) {
    // Inconsistência de status (sem comanda): só corrige a mesa.
    await db.orm.public.Table.where({ id: tableId }).update({ status: 'AVAILABLE' });
    return { comandaId: '', warnings: ['Mesa liberada (nenhuma comanda em aberto)'] };
  }

  const result = await closeComanda(comanda.id, paymentMethod);
  return { comandaId: comanda.id, warnings: result.warnings };
}
