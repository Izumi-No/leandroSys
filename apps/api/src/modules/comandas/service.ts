import { badRequest, conflict, notFound } from '../../lib/errors';
import { money, round2, toNumber } from '../../lib/money';
import { db } from '../../prisma/db';
import { enqueueJob, loadRouteMaps, pickPrinters, type DbLike, type RoutedPrinter } from '../printing/queue';
import { billTicket, itemsTicket, type TicketComanda, type TicketItem } from '../printing/tickets';

export type ComandaStatus = 'OPEN' | 'PAYING' | 'CLOSED';
export type PaymentMethod = 'MONEY' | 'CARD' | 'PIX' | 'OTHER';
export type ItemStatus = 'PENDING' | 'SENT' | 'IN_PREP' | 'READY' | 'SERVED' | 'CANCELED';

type Money = string | number | { toString(): string };

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
  /** `.include('product', cb)` tipa a relação como opcional. */
  product: { name: string } | null;
  aditionals: { aditional: { name: string; price: Money } }[];
};

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Comanda completa: tabela, atendente e itens com produto/adicionais. */
export function loadComanda(id: string) {
  return db.orm.public.Comanda
    .where({ id })
    .include('table')
    .include('waiter')
    .include('items', (items) =>
      items
        .orderBy((item) => item.createdAt.asc())
        .include('product', (product) => product.include('category'))
        .include('aditionals', (join) => join.include('aditional')),
    )
    .first();
}

/** Lista de comandas (resumo), com tabela, atendente e contagem de itens. */
export async function listComandas(status?: ComandaStatus) {
  const base = status ? db.orm.public.Comanda.where({ status }) : db.orm.public.Comanda;
  return base
    .orderBy((comanda) => comanda.openedAt.desc())
    .include('table')
    .include('waiter')
    .include('items', (items) => items.select('id', 'status'))
    .all();
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
  const items = await client.orm.public.ComandaItem
    .where({ comandaId })
    .include('aditionals', (join) => join.include('aditional'))
    .all();

  const total = round2(
    items.reduce((sum, item) => (item.status === 'CANCELED' ? sum : sum + itemTotal(item)), 0),
  );

  await client.orm.public.Comanda.where({ id: comandaId }).update({ total: total.toFixed(2) });
  return total;
}

async function activeBillItems(client: DbLike, comandaId: string) {
  return client.orm.public.ComandaItem
    .where({ comandaId })
    .where((item) => item.status.neq('CANCELED'))
    .orderBy((item) => item.createdAt.asc())
    .include('product')
    .include('aditionals', (join) => join.include('aditional'))
    .all();
}

async function ticketContext(
  client: DbLike,
  comanda: { number: number; tableId: string; waiterId: string | null; openedAt: Date },
): Promise<TicketComanda> {
  const table = await client.orm.public.Table.first({ id: comanda.tableId });
  const waiter = comanda.waiterId ? await client.orm.public.User.first({ id: comanda.waiterId }) : null;
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
  const printer = await client.orm.public.Printer
    .where({ printsBill: true })
    .where((printer) => printer.active.eq(true))
    .first();

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
  return db.transaction(async (tx) => {
    const table = await tx.orm.public.Table.where({ id: input.tableId }).forUpdate().first();
    if (!table) throw notFound('Mesa não encontrada');
    if (table.status === 'OCCUPIED') throw conflict('Mesa já está ocupada');
    if (table.status === 'RESERVED') throw conflict('Mesa reservada: cancele a reserva antes de ocupar');

    const comanda = await tx.orm.public.Comanda.create({
      tableId: table.id,
      waiterId: input.waiterId ?? null,
      status: 'OPEN',
    });

    await tx.orm.public.Table.where({ id: table.id }).update({ status: 'OCCUPIED' });
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
  return db.transaction(async (tx) => {
    const comanda = await tx.orm.public.Comanda.where({ id: comandaId }).forUpdate().first();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status !== 'OPEN') throw conflict('Só é possível lançar itens em comanda aberta');

    const product = await tx.orm.public.Product.first({ id: input.productId });
    if (!product || !product.active) throw notFound('Produto não encontrado');

    const aditionalIds = [...new Set(input.aditionalIds ?? [])];
    const aditionals = aditionalIds.length
      ? await tx.orm.public.Aditional.where((aditional) => aditional.id.in(aditionalIds)).all()
      : [];
    if (aditionals.length !== aditionalIds.length) throw notFound('Adicional não encontrado');

    const item = await tx.orm.public.ComandaItem.create({
      comandaId,
      productId: product.id,
      quantity: input.quantity,
      unitPrice: product.price,
      note: input.note ?? null,
      status: 'PENDING',
    });

    for (const aditional of aditionals) {
      await tx.orm.public.ComandaItemAditional.create({
        comandaItemId: item.id,
        aditionalId: aditional.id,
      });
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
  await db.transaction(async (tx) => {
    const comanda = await tx.orm.public.Comanda.where({ id: comandaId }).forUpdate().first();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status !== 'OPEN') throw conflict('Comanda não está aberta');

    const item = await tx.orm.public.ComandaItem.where({ id: itemId, comandaId }).first();
    if (!item) throw notFound('Item não encontrado');
    if (item.status === 'CANCELED') throw conflict('Item está cancelado');

    const patch: { quantity?: number; note?: string | null; status?: 'IN_PREP' | 'READY' | 'SERVED' } = {};
    if (input.quantity !== undefined) patch.quantity = input.quantity;
    if (input.note !== undefined) patch.note = input.note;
    if (input.status !== undefined) patch.status = input.status;
    if (Object.keys(patch).length === 0) throw badRequest('Nada para atualizar');

    await tx.orm.public.ComandaItem.where({ id: itemId }).update(patch);
    if (input.quantity !== undefined) await recomputeTotal(tx, comandaId);
  });
}

/** Item pendente é apagado; item já enviado vira CANCELED (mantém o histórico). */
export async function removeItem(comandaId: string, itemId: string): Promise<'REMOVED' | 'CANCELED'> {
  return db.transaction(async (tx) => {
    const comanda = await tx.orm.public.Comanda.where({ id: comandaId }).forUpdate().first();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status !== 'OPEN') throw conflict('Comanda não está aberta');

    const item = await tx.orm.public.ComandaItem.where({ id: itemId, comandaId }).first();
    if (!item) throw notFound('Item não encontrado');

    if (item.status === 'PENDING') {
      await tx.orm.public.ComandaItem.where({ id: itemId }).delete();
      await recomputeTotal(tx, comandaId);
      return 'REMOVED' as const;
    }

    if (item.status === 'CANCELED') throw conflict('Item já está cancelado');

    await tx.orm.public.ComandaItem.where({ id: itemId }).update({ status: 'CANCELED' });
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
  return db.transaction(async (tx) => {
    const comanda = await tx.orm.public.Comanda.where({ id: comandaId }).forUpdate().first();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status !== 'OPEN') throw conflict('Comanda não está aberta');

    const pending = await tx.orm.public.ComandaItem
      .where({ comandaId, status: 'PENDING' })
      .orderBy((item) => item.createdAt.asc())
      .include('product', (product) => product.include('category'))
      .include('aditionals', (join) => join.include('aditional'))
      .all();

    if (pending.length === 0) throw badRequest('Nenhum item pendente de envio');

    const maps = await loadRouteMaps(
      tx,
      pending.map((item) => item.productId),
      pending.map((item) => item.product?.categoryId ?? ''),
    );

    const buckets = new Map<string, { printer: RoutedPrinter; items: typeof pending }>();
    const unrouted: { itemId: string; product: string }[] = [];

    for (const item of pending) {
      const categoryId = item.product?.categoryId ?? '';
      const printers = pickPrinters(maps, item.productId, categoryId);
      if (printers.length === 0) {
        unrouted.push({ itemId: item.id, product: item.product?.name ?? item.productId });
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

    for (const itemId of sentItems) {
      await tx.orm.public.ComandaItem.where({ id: itemId }).update({ status: 'SENT' });
    }

    return { jobIds, sentItems: [...sentItems], unrouted };
  });
}

/** Reimprime um item específico (mesma rota do envio normal). */
export async function reprintItem(comandaId: string, itemId: string): Promise<string[]> {
  return db.transaction(async (tx) => {
    const comanda = await tx.orm.public.Comanda.where({ id: comandaId }).forUpdate().first();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status === 'CLOSED') throw conflict('Comanda já foi fechada');

    const item = await tx.orm.public.ComandaItem
      .where({ id: itemId, comandaId })
      .include('product', (product) => product.include('category'))
      .include('aditionals', (join) => join.include('aditional'))
      .first();
    if (!item) throw notFound('Item não encontrado');

    const categoryId = item.product?.categoryId ?? '';
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
  return db.transaction(async (tx) => {
    const comanda = await tx.orm.public.Comanda.where({ id: comandaId }).forUpdate().first();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status === 'CLOSED') throw conflict('Comanda já foi fechada');
    if (comanda.status === 'PAYING') return { billJobId: null, warnings: ['Comanda já está em pagamento'] };

    const warnings: string[] = [];
    const billJobId = await enqueueBill(tx, comanda, warnings);
    await tx.orm.public.Comanda.where({ id: comandaId }).update({ status: 'PAYING' });
    await recomputeTotal(tx, comandaId);

    return { billJobId, warnings };
  });
}

/** Fecha a comanda, imprime a conta (se ainda não foi) e libera a mesa. */
export async function closeComanda(
  comandaId: string,
  paymentMethod?: PaymentMethod,
): Promise<{ billJobId: string | null; warnings: string[] }> {
  return db.transaction(async (tx) => {
    const comanda = await tx.orm.public.Comanda.where({ id: comandaId }).forUpdate().first();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status === 'CLOSED') throw conflict('Comanda já foi fechada');

    const warnings: string[] = [];
    const billJobId = comanda.status === 'OPEN' ? await enqueueBill(tx, comanda, warnings) : null;

    const pending = await tx.orm.public.ComandaItem.where({ comandaId, status: 'PENDING' }).all();
    if (pending.length > 0) {
      warnings.push(`${pending.length} item(ns) nunca foi(ram) enviado(s) para impressão`);
    }

    const total = await recomputeTotal(tx, comandaId);

    await tx.orm.public.Comanda.where({ id: comandaId }).update({
      status: 'CLOSED',
      closedAt: new Date(),
      paymentMethod: paymentMethod ?? null,
      total: total.toFixed(2),
    });
    await tx.orm.public.Table.where({ id: comanda.tableId }).update({ status: 'AVAILABLE' });

    return { billJobId, warnings };
  });
}

/** Apaga uma comanda aberta e sem itens (desfaz "pegar a mesa"). */
export async function deleteComanda(comandaId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const comanda = await tx.orm.public.Comanda.where({ id: comandaId }).forUpdate().first();
    if (!comanda) throw notFound('Comanda não encontrada');
    if (comanda.status === 'CLOSED') throw conflict('Comanda já foi fechada');

    const items = await tx.orm.public.ComandaItem.where({ comandaId }).all();
    if (items.length > 0) throw conflict('Comanda possui itens; cancele os itens antes de apagar');

    await tx.orm.public.Comanda.where({ id: comandaId }).delete();
    await tx.orm.public.Table.where({ id: comanda.tableId }).update({ status: 'AVAILABLE' });
  });
}
