import type { Selectable, Updateable } from 'kysely';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { money, round2, toNumber } from '../../lib/money';
import { db } from '../../prisma/db';
import type { Database } from '../../prisma/types';
import { enqueueJob, loadRouteMaps, pickPrinters, type DbLike, type RoutedPrinter } from '../printing/queue';
import { billTicket, itemsTicket, type TicketComanda, type TicketItem } from '../printing/tickets';

export type ComandaStatus = 'OPEN' | 'PAYING' | 'CLOSED';
export type PaymentMethod = 'MONEY' | 'CARD' | 'PIX' | 'OTHER';
export type ItemStatus = 'PENDING' | 'SENT' | 'IN_PREP' | 'READY' | 'SERVED' | 'CANCELED';

type Money = string | number | { toString(): string };

type ComandaRow = Selectable<Database['Comanda']>;
type ComandaItemRow = Selectable<Database['ComandaItem']>;

/** Campos que o cálculo de total precisa (produto não é obrigatório aqui). */
type ItemTotalsLike = {
  quantity: number;
  unitPrice: Money;
  aditionals: { aditional: { price: Money } }[];
};

/** Forma mínima de item que um cupom precisa — vale para qualquer query com produto/adicionais. */
type ItemLike = {
  quantity: number;
  unitPrice: Money;
  note: string | null;
  product: { name: string } | null;
  aditionals: { aditional: { name: string; price: Money } }[];
};

type AditionalRef = { id: string; name: string; price: string };

/** Item de comanda com produto (e categoria) e adicionais já resolvidos. */
export type ComandaItemDetail = ComandaItemRow & {
  product: { name: string; categoryId: string; category: { name: string } };
  aditionals: { aditional: AditionalRef }[];
};

type ComandaRelations = {
  table: { id: string; number: number };
  waiter: { id: string; username: string; role: string } | null;
};

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

async function loadAditionalsByItem(client: DbLike, itemIds: string[]): Promise<Map<string, AditionalRef[]>> {
  const map = new Map<string, AditionalRef[]>();
  if (itemIds.length === 0) return map;

  const links = await client
    .selectFrom('ComandaItemAditional')
    .selectAll()
    .where('comandaItemId', 'in', itemIds)
    .execute();
  if (links.length === 0) return map;

  const aditionalIds = [...new Set(links.map((link) => link.aditionalId))];
  const aditionals = await client.selectFrom('Aditional').selectAll().where('id', 'in', aditionalIds).execute();
  const byId = new Map(aditionals.map((aditional) => [aditional.id, aditional]));

  for (const link of links) {
    const aditional = byId.get(link.aditionalId);
    if (!aditional) continue;
    const list = map.get(link.comandaItemId) ?? [];
    list.push({ id: aditional.id, name: aditional.name, price: aditional.price });
    map.set(link.comandaItemId, list);
  }

  return map;
}

type ItemFilter = {
  itemId?: string;
  status?: ItemStatus;
  excludeCanceled?: boolean;
};

/** Itens de uma comanda com produto/categoria e adicionais resolvidos (sem N+1). */
async function loadItems(client: DbLike, comandaId: string, filter: ItemFilter = {}): Promise<ComandaItemDetail[]> {
  let query = client.selectFrom('ComandaItem').selectAll().where('comandaId', '=', comandaId);
  if (filter.itemId) query = query.where('id', '=', filter.itemId);
  if (filter.status) query = query.where('status', '=', filter.status);
  if (filter.excludeCanceled) query = query.where('status', '!=', 'CANCELED');

  const items = await query.orderBy('createdAt', 'asc').execute();
  if (items.length === 0) return [];

  const productIds = [...new Set(items.map((item) => item.productId))];
  const products = await client.selectFrom('Product').selectAll().where('id', 'in', productIds).execute();

  const categoryIds = [...new Set(products.map((product) => product.categoryId))];
  const categories = await client.selectFrom('Category').selectAll().where('id', 'in', categoryIds).execute();

  const byProduct = new Map(products.map((product) => [product.id, product]));
  const byCategory = new Map(categories.map((category) => [category.id, category]));
  const aditionalsByItem = await loadAditionalsByItem(
    client,
    items.map((item) => item.id),
  );

  return items.map((item) => {
    const product = byProduct.get(item.productId);
    const category = product ? byCategory.get(product.categoryId) : undefined;
    return {
      ...item,
      product: {
        name: product?.name ?? '',
        categoryId: product?.categoryId ?? '',
        category: { name: category?.name ?? '' },
      },
      aditionals: (aditionalsByItem.get(item.id) ?? []).map((aditional) => ({ aditional })),
    };
  });
}

/** Comanda completa: tabela, atendente e itens com produto/adicionais. */
export async function loadComanda(id: string): Promise<(ComandaRow & { items: ComandaItemDetail[] } & ComandaRelations) | undefined> {
  const comanda = await db.selectFrom('Comanda').selectAll().where('id', '=', id).executeTakeFirst();
  if (!comanda) return undefined;

  const [table, waiter, items] = await Promise.all([
    db.selectFrom('Table').select(['id', 'number']).where('id', '=', comanda.tableId).executeTakeFirst(),
    comanda.waiterId
      ? db.selectFrom('User').select(['id', 'username', 'role']).where('id', '=', comanda.waiterId).executeTakeFirst()
      : Promise.resolve(undefined),
    loadItems(db, id),
  ]);

  return {
    ...comanda,
    table: table ?? { id: comanda.tableId, number: 0 },
    waiter: waiter ?? null,
    items,
  };
}

/** Lista de comandas (resumo), com tabela, atendente e contagem de itens. */
export async function listComandas(status?: ComandaStatus) {
  let query = db.selectFrom('Comanda').selectAll();
  if (status) query = query.where('status', '=', status);
  const comandas = await query.orderBy('openedAt', 'desc').execute();
  if (comandas.length === 0) return [];

  const tableIds = [...new Set(comandas.map((comanda) => comanda.tableId))];
  const waiterIds = [...new Set(comandas.map((comanda) => comanda.waiterId).filter((id): id is string => !!id))];

  const [tables, waiters, items] = await Promise.all([
    db.selectFrom('Table').select(['id', 'number']).where('id', 'in', tableIds).execute(),
    waiterIds.length > 0
      ? db.selectFrom('User').select(['id', 'username', 'role']).where('id', 'in', waiterIds).execute()
      : Promise.resolve([]),
    db
      .selectFrom('ComandaItem')
      .select(['id', 'comandaId', 'status'])
      .where(
        'comandaId',
        'in',
        comandas.map((comanda) => comanda.id),
      )
      .execute(),
  ]);

  const byTable = new Map(tables.map((table) => [table.id, table]));
  const byWaiter = new Map(waiters.map((waiter) => [waiter.id, waiter]));
  const itemsByComanda = new Map<string, { id: string; status: ItemStatus }[]>();
  for (const item of items) {
    const list = itemsByComanda.get(item.comandaId) ?? [];
    list.push({ id: item.id, status: item.status });
    itemsByComanda.set(item.comandaId, list);
  }

  return comandas.map((comanda) => ({
    ...comanda,
    table: byTable.get(comanda.tableId) ?? { id: comanda.tableId, number: 0 },
    waiter: comanda.waiterId ? (byWaiter.get(comanda.waiterId) ?? null) : null,
    items: itemsByComanda.get(comanda.id) ?? [],
  }));
}

export type ComandaListRow = Awaited<ReturnType<typeof listComandas>>[number];
export type ComandaDetailRow = NonNullable<Awaited<ReturnType<typeof loadComanda>>>;

type ComandaSummarySource = {
  id: string;
  number: number;
  status: ComandaStatus;
  openedAt: Date;
  closedAt: Date | null;
  paymentMethod: PaymentMethod | null;
  total: Money;
  table: { id: string; number: number };
  waiter: { id: string; username: string; role: string } | null;
  items: { status: ItemStatus }[];
};

const activeItems = <T extends { status: ItemStatus }>(items: T[]): T[] =>
  items.filter((item) => item.status !== 'CANCELED');

const itemTotal = (item: ItemTotalsLike): number => {
  const extras = item.aditionals.reduce((sum, join) => sum + toNumber(join.aditional.price), 0);
  return round2((toNumber(item.unitPrice) + extras) * item.quantity);
};

const ticketItem = (item: ItemLike): TicketItem => ({
  quantity: item.quantity,
  name: item.product?.name ?? 'Item',
  note: item.note,
  aditionals: item.aditionals.map((join) => join.aditional.name),
  total: itemTotal(item),
});

function summary(row: ComandaSummarySource) {
  const items = activeItems(row.items);
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    paymentMethod: row.paymentMethod,
    total: money(row.total),
    table: { id: row.table.id, number: row.table.number },
    waiter: row.waiter ? { id: row.waiter.id, username: row.waiter.username, role: row.waiter.role } : null,
    itemCount: items.length,
    pendingItems: items.filter((item) => item.status === 'PENDING').length,
  };
}

export function serializeComandaSummary(row: ComandaListRow) {
  return summary(row);
}

export function serializeComandaDetail(row: ComandaDetailRow) {
  return {
    ...summary(row),
    items: row.items.map((item) => ({
      id: item.id,
      status: item.status,
      quantity: item.quantity,
      note: item.note,
      createdAt: item.createdAt,
      unitPrice: money(item.unitPrice),
      total: itemTotal(item),
      canceled: item.status === 'CANCELED',
      product: {
        id: item.productId,
        name: item.product?.name ?? '',
        categoryId: item.product?.categoryId ?? '',
        category: item.product?.category.name ?? '',
      },
      aditionals: item.aditionals.map((join) => ({
        id: join.aditional.id,
        name: join.aditional.name,
        price: money(join.aditional.price),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Internos
// ---------------------------------------------------------------------------

async function recomputeTotal(client: DbLike, comandaId: string): Promise<number> {
  const items = await client.selectFrom('ComandaItem').selectAll().where('comandaId', '=', comandaId).execute();
  const aditionalsByItem = await loadAditionalsByItem(
    client,
    items.map((item) => item.id),
  );

  const total = round2(
    items.reduce((sum, item) => {
      if (item.status === 'CANCELED') return sum;
      const aditionals = (aditionalsByItem.get(item.id) ?? []).map((aditional) => ({
        aditional: { price: aditional.price },
      }));
      return sum + itemTotal({ quantity: item.quantity, unitPrice: item.unitPrice, aditionals });
    }, 0),
  );

  await client.updateTable('Comanda').set({ total: total.toFixed(2) }).where('id', '=', comandaId).execute();
  return total;
}

async function activeBillItems(client: DbLike, comandaId: string) {
  return loadItems(client, comandaId, { excludeCanceled: true });
}

async function ticketContext(
  client: DbLike,
  comanda: { number: number; tableId: string; waiterId: string | null; openedAt: Date },
): Promise<TicketComanda> {
  const table = await client.selectFrom('Table').select(['number']).where('id', '=', comanda.tableId).executeTakeFirst();
  const waiter = comanda.waiterId
    ? await client.selectFrom('User').select(['username']).where('id', '=', comanda.waiterId).executeTakeFirst()
    : null;
  return {
    number: comanda.number,
    tableNumber: table?.number ?? 0,
    waiter: waiter?.username ?? null,
    openedAt: comanda.openedAt,
  };
}

/** Enfileira a conta na impressora marcada com `printsBill`. */
async function enqueueBill(
  client: DbLike,
  comanda: { id: string; number: number; tableId: string; waiterId: string | null; openedAt: Date },
  warnings: string[],
  paymentMethod?: PaymentMethod | null,
): Promise<string | null> {
  const printer = await client
    .selectFrom('Printer')
    .selectAll()
    .where('printsBill', '=', true)
    .where('active', '=', true)
    .executeTakeFirst();

  if (!printer) {
    warnings.push('Nenhuma impressora ativa configurada para contas');
    return null;
  }

  const context = await ticketContext(client, comanda);
  const items = await activeBillItems(client, comanda.id);
  const total = round2(items.reduce((sum, item) => sum + itemTotal(item), 0));

  return enqueueJob(client, {
    printerId: printer.id,
    comandaId: comanda.id,
    kind: 'BILL',
    payload: billTicket(
      context,
      items.map(ticketItem),
      total,
      paymentMethod ?? null,
    ),
  });
}

// ---------------------------------------------------------------------------
// Mutações
// ---------------------------------------------------------------------------

export async function openComanda(input: { tableId: string; waiterId?: string | null }): Promise<string> {
  return db.transaction().execute(async (tx) => {
    const table = await tx.selectFrom('Table').selectAll().where('id', '=', input.tableId).forUpdate().executeTakeFirst();
    if (!table) throw notFound('Mesa não encontrada');
    if (table.status === 'OCCUPIED') throw conflict('Mesa já está ocupada');
    if (table.status === 'RESERVED') throw conflict('Mesa reservada: cancele a reserva antes de ocupar');

    const comanda = await tx
      .insertInto('Comanda')
      .values({
        tableId: table.id,
        waiterId: input.waiterId ?? null,
        status: 'OPEN',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await tx.updateTable('Table').set({ status: 'OCCUPIED' }).where('id', '=', table.id).execute();
    return comanda.id;
  });
}

export type AddItemInput = {
  productId: string;
  quantity: number;
  note?: string | null;
  aditionalIds?: string[];
};

export async function addItem(comandaId: string, input: AddItemInput): Promise<string> {
  return db.transaction().execute(async (tx) => {
    const comanda = await tx.selectFrom('Comanda').selectAll().where('id', '=', comandaId).forUpdate().executeTakeFirst();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status !== 'OPEN') throw conflict('Só é possível lançar itens em comanda aberta');

    const product = await tx.selectFrom('Product').selectAll().where('id', '=', input.productId).executeTakeFirst();
    if (!product || !product.active) throw notFound('Produto não encontrado');

    const aditionalIds = [...new Set(input.aditionalIds ?? [])];
    const aditionals = aditionalIds.length
      ? await tx.selectFrom('Aditional').selectAll().where('id', 'in', aditionalIds).execute()
      : [];
    if (aditionals.length !== aditionalIds.length) throw notFound('Adicional não encontrado');

    const item = await tx
      .insertInto('ComandaItem')
      .values({
        comandaId,
        productId: product.id,
        quantity: input.quantity,
        unitPrice: product.price,
        note: input.note ?? null,
        status: 'PENDING',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    if (aditionals.length > 0) {
      await tx
        .insertInto('ComandaItemAditional')
        .values(aditionals.map((aditional) => ({ comandaItemId: item.id, aditionalId: aditional.id })))
        .execute();
    }

    await recomputeTotal(tx, comandaId);
    return item.id;
  });
}

export type UpdateItemInput = {
  quantity?: number;
  note?: string | null;
  status?: 'IN_PREP' | 'READY' | 'SERVED';
};

export async function updateItem(comandaId: string, itemId: string, input: UpdateItemInput): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const comanda = await tx.selectFrom('Comanda').selectAll().where('id', '=', comandaId).forUpdate().executeTakeFirst();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status !== 'OPEN') throw conflict('Comanda não está aberta');

    const item = await tx
      .selectFrom('ComandaItem')
      .selectAll()
      .where('id', '=', itemId)
      .where('comandaId', '=', comandaId)
      .executeTakeFirst();
    if (!item) throw notFound('Item não encontrado');
    if (item.status === 'CANCELED') throw conflict('Item está cancelado');

    const patch: Updateable<Database['ComandaItem']> = {};
    if (input.quantity !== undefined) patch.quantity = input.quantity;
    if (input.note !== undefined) patch.note = input.note;
    if (input.status !== undefined) patch.status = input.status;
    if (Object.keys(patch).length === 0) throw badRequest('Nada para atualizar');

    await tx.updateTable('ComandaItem').set(patch).where('id', '=', itemId).execute();
    if (input.quantity !== undefined) await recomputeTotal(tx, comandaId);
  });
}

/** Item pendente é apagado; item já enviado vira CANCELED (mantém o histórico). */
export async function removeItem(comandaId: string, itemId: string): Promise<'REMOVED' | 'CANCELED'> {
  return db.transaction().execute(async (tx) => {
    const comanda = await tx.selectFrom('Comanda').selectAll().where('id', '=', comandaId).forUpdate().executeTakeFirst();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status !== 'OPEN') throw conflict('Comanda não está aberta');

    const item = await tx
      .selectFrom('ComandaItem')
      .selectAll()
      .where('id', '=', itemId)
      .where('comandaId', '=', comandaId)
      .executeTakeFirst();
    if (!item) throw notFound('Item não encontrado');

    if (item.status === 'PENDING') {
      await tx.deleteFrom('ComandaItemAditional').where('comandaItemId', '=', itemId).execute();
      await tx.deleteFrom('ComandaItem').where('id', '=', itemId).execute();
      await recomputeTotal(tx, comandaId);
      return 'REMOVED' as const;
    }

    if (item.status === 'CANCELED') throw conflict('Item já está cancelado');

    await tx.updateTable('ComandaItem').set({ status: 'CANCELED' }).where('id', '=', itemId).execute();
    await recomputeTotal(tx, comandaId);
    return 'CANCELED' as const;
  });
}

export type SendResult = {
  jobIds: string[];
  sentItems: string[];
  unrouted: { itemId: string; product: string }[];
};

/** Manda os itens PENDING para as impressoras das rotas (item vence categoria). */
export async function sendComanda(comandaId: string): Promise<SendResult> {
  return db.transaction().execute(async (tx) => {
    const comanda = await tx.selectFrom('Comanda').selectAll().where('id', '=', comandaId).forUpdate().executeTakeFirst();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status !== 'OPEN') throw conflict('Comanda não está aberta');

    const pending = await loadItems(tx, comandaId, { status: 'PENDING' });
    if (pending.length === 0) throw badRequest('Nenhum item pendente de envio');

    const maps = await loadRouteMaps(
      tx,
      pending.map((item) => item.productId),
      pending.map((item) => item.product.categoryId),
    );

    const buckets = new Map<string, { printer: RoutedPrinter; items: typeof pending }>();
    const unrouted: { itemId: string; product: string }[] = [];

    for (const item of pending) {
      const categoryId = item.product.categoryId;
      const printers = pickPrinters(maps, item.productId, categoryId);
      if (printers.length === 0) {
        unrouted.push({ itemId: item.id, product: item.product.name || item.productId });
        continue;
      }
      for (const printer of printers) {
        const bucket = buckets.get(printer.id);
        if (bucket) bucket.items.push(item);
        else buckets.set(printer.id, { printer, items: [item] });
      }
    }

    if (buckets.size === 0) {
      throw conflict('Nenhuma rota de impressão para os itens pendentes', { unrouted });
    }

    const context = await ticketContext(tx, comanda);
    const jobIds: string[] = [];
    const sentItems = new Set<string>();

    for (const { printer, items } of buckets.values()) {
      jobIds.push(
        await enqueueJob(tx, {
          printerId: printer.id,
          comandaId,
          kind: 'ITEM',
          payload: itemsTicket(
            printer.name,
            context,
            items.map(ticketItem),
          ),
        }),
      );
      for (const item of items) sentItems.add(item.id);
    }

    if (sentItems.size > 0) {
      await tx
        .updateTable('ComandaItem')
        .set({ status: 'SENT' })
        .where('id', 'in', [...sentItems])
        .execute();
    }

    return { jobIds, sentItems: [...sentItems], unrouted };
  });
}

/** Reimprime um item específico (mesma rota do envio normal). */
export async function reprintItem(comandaId: string, itemId: string): Promise<string[]> {
  return db.transaction().execute(async (tx) => {
    const comanda = await tx.selectFrom('Comanda').selectAll().where('id', '=', comandaId).forUpdate().executeTakeFirst();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status === 'CLOSED') throw conflict('Comanda já foi fechada');

    const [item] = await loadItems(tx, comandaId, { itemId });
    if (!item) throw notFound('Item não encontrado');

    const categoryId = item.product.categoryId;
    const maps = await loadRouteMaps(tx, [item.productId], [categoryId]);
    const printers = pickPrinters(maps, item.productId, categoryId);
    if (printers.length === 0) throw conflict('Sem rota de impressão para este item');

    const context = await ticketContext(tx, comanda);
    const jobIds: string[] = [];

    for (const printer of printers) {
      jobIds.push(
        await enqueueJob(tx, {
          printerId: printer.id,
          comandaId,
          comandaItemId: item.id,
          kind: 'ITEM',
          payload: itemsTicket(printer.name, context, [ticketItem(item)]),
        }),
      );
    }

    return jobIds;
  });
}

/** OPEN -> PAYING e imprime a conta. Idempotente se já está em PAYING. */
export async function checkoutComanda(comandaId: string): Promise<{ billJobId: string | null; warnings: string[] }> {
  return db.transaction().execute(async (tx) => {
    const comanda = await tx.selectFrom('Comanda').selectAll().where('id', '=', comandaId).forUpdate().executeTakeFirst();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status === 'CLOSED') throw conflict('Comanda já foi fechada');
    if (comanda.status === 'PAYING') return { billJobId: null, warnings: ['Comanda já está em pagamento'] };

    const warnings: string[] = [];
    const billJobId = await enqueueBill(tx, comanda, warnings);
    await tx.updateTable('Comanda').set({ status: 'PAYING' }).where('id', '=', comandaId).execute();
    await recomputeTotal(tx, comandaId);

    return { billJobId, warnings };
  });
}

/** Fecha a comanda, imprime a conta (se ainda não foi) e libera a mesa. */
export async function closeComanda(
  comandaId: string,
  paymentMethod?: PaymentMethod,
): Promise<{ billJobId: string | null; warnings: string[] }> {
  return db.transaction().execute(async (tx) => {
    const comanda = await tx.selectFrom('Comanda').selectAll().where('id', '=', comandaId).forUpdate().executeTakeFirst();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status === 'CLOSED') throw conflict('Comanda já foi fechada');

    const warnings: string[] = [];
    const billJobId = comanda.status === 'OPEN' ? await enqueueBill(tx, comanda, warnings) : null;

    const pending = await tx
      .selectFrom('ComandaItem')
      .select(['id'])
      .where('comandaId', '=', comandaId)
      .where('status', '=', 'PENDING')
      .execute();
    if (pending.length > 0) {
      warnings.push(`${pending.length} item(ns) nunca foi(ram) enviado(s) para impressão`);
    }

    const total = await recomputeTotal(tx, comandaId);

    await tx
      .updateTable('Comanda')
      .set({
        status: 'CLOSED',
        closedAt: new Date(),
        paymentMethod: paymentMethod ?? null,
        total: total.toFixed(2),
      })
      .where('id', '=', comandaId)
      .execute();
    await tx.updateTable('Table').set({ status: 'AVAILABLE' }).where('id', '=', comanda.tableId).execute();

    return { billJobId, warnings };
  });
}

/** Apaga uma comanda aberta e sem itens (desfaz "pegar a mesa"). */
export async function deleteComanda(comandaId: string): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const comanda = await tx.selectFrom('Comanda').selectAll().where('id', '=', comandaId).forUpdate().executeTakeFirst();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status === 'CLOSED') throw conflict('Comanda já foi fechada');

    const items = await tx.selectFrom('ComandaItem').select(['id']).where('comandaId', '=', comandaId).execute();
    if (items.length > 0) throw conflict('Comanda possui itens; cancele os itens antes de apagar');

    await tx.deleteFrom('Comanda').where('id', '=', comandaId).execute();
    await tx.updateTable('Table').set({ status: 'AVAILABLE' }).where('id', '=', comanda.tableId).execute();
  });
}
