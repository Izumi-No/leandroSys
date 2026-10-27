import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../prisma/types';
import type { TicketDoc } from './escpos';

export type DbLike = Kysely<Database> | Transaction<Database>;

export type RoutedPrinter = {
  id: string;
  name: string;
  columns: number;
  codepage: number;
};

export type RouteMaps = {
  byProduct: Map<string, RoutedPrinter[]>;
  byCategory: Map<string, RoutedPrinter[]>;
};

const push = (map: Map<string, RoutedPrinter[]>, key: string, printer: RoutedPrinter | null): void => {
  if (!printer) return;
  const current = map.get(key);
  if (current) current.push(printer);
  else map.set(key, [printer]);
};

type RouteRow = {
  productId: string | null;
  categoryId: string | null;
  printerId: string;
  printerName: string;
  printerColumns: number;
  printerCodepage: number;
  printerActive: boolean;
};

const toRoutedPrinter = (row: RouteRow): RoutedPrinter | null =>
  row.printerActive
    ? {
        id: row.printerId,
        name: row.printerName,
        columns: row.printerColumns,
        codepage: row.printerCodepage,
      }
    : null;

const ROUTE_SELECTION = [
  'PrintRoute.productId as productId',
  'PrintRoute.categoryId as categoryId',
  'Printer.id as printerId',
  'Printer.name as printerName',
  'Printer.columns as printerColumns',
  'Printer.codepage as printerCodepage',
  'Printer.active as printerActive',
] as const;

export async function loadRouteMaps(
  client: DbLike,
  productIds: string[],
  categoryIds: string[],
): Promise<RouteMaps> {
  const products = [...new Set(productIds)];
  const categories = [...new Set(categoryIds)];

  const maps: RouteMaps = { byProduct: new Map(), byCategory: new Map() };

  if (products.length > 0) {
    const routes: RouteRow[] = await client
      .selectFrom('PrintRoute')
      .innerJoin('Printer', 'Printer.id', 'PrintRoute.printerId')
      .select(ROUTE_SELECTION)
      .where('PrintRoute.productId', 'in', products)
      .orderBy('PrintRoute.priority', 'desc')
      .execute();

    for (const route of routes) {
      if (!route.productId) continue;
      push(maps.byProduct, route.productId, toRoutedPrinter(route));
    }
  }

  if (categories.length > 0) {
    const routes: RouteRow[] = await client
      .selectFrom('PrintRoute')
      .innerJoin('Printer', 'Printer.id', 'PrintRoute.printerId')
      .select(ROUTE_SELECTION)
      .where('PrintRoute.categoryId', 'in', categories)
      .orderBy('PrintRoute.priority', 'desc')
      .execute();

    for (const route of routes) {
      if (!route.categoryId) continue;
      push(maps.byCategory, route.categoryId, toRoutedPrinter(route));
    }
  }

  return maps;
}

export function pickPrinters(maps: RouteMaps, productId: string, categoryId: string): RoutedPrinter[] {
  return maps.byProduct.get(productId) ?? maps.byCategory.get(categoryId) ?? [];
}

export type EnqueueInput = {
  printerId: string;
  comandaId?: string | null;
  comandaItemId?: string | null;
  kind: 'ITEM' | 'COMANDA' | 'BILL' | 'TEST';
  payload: TicketDoc;
};

export async function enqueueJob(client: DbLike, input: EnqueueInput): Promise<string> {
  const job = await client
    .insertInto('PrintJob')
    .values({
      printerId: input.printerId,
      comandaId: input.comandaId ?? null,
      comandaItemId: input.comandaItemId ?? null,
      kind: input.kind,
      payload: input.payload,
    })
    .returning('id')
    .executeTakeFirst();
  if (!job) throw new Error('Failed to enqueue print job');
  return job.id;
}
