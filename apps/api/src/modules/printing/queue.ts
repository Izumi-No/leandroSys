import { desc, eq, inArray } from 'drizzle-orm';
import type { DbLike } from '../../db';
import { printJobs, printRoutes, printers } from '../../db/schema';
import type { TicketDoc } from './escpos';

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

const routeSelection = {
  productId: printRoutes.productId,
  categoryId: printRoutes.categoryId,
  printerId: printers.id,
  printerName: printers.name,
  printerColumns: printers.columns,
  printerCodepage: printers.codepage,
  printerActive: printers.active,
};

export async function loadRouteMaps(
  client: DbLike,
  productIds: string[],
  categoryIds: string[],
): Promise<RouteMaps> {
  const products = [...new Set(productIds)];
  const categories = [...new Set(categoryIds)];
  const maps: RouteMaps = { byProduct: new Map(), byCategory: new Map() };

  if (products.length > 0) {
    const routes = await client
      .select(routeSelection)
      .from(printRoutes)
      .innerJoin(printers, eq(printers.id, printRoutes.printerId))
      .where(inArray(printRoutes.productId, products))
      .orderBy(desc(printRoutes.priority));

    for (const route of routes) {
      if (!route.productId) continue;
      push(maps.byProduct, route.productId, toRoutedPrinter(route));
    }
  }

  if (categories.length > 0) {
    const routes = await client
      .select(routeSelection)
      .from(printRoutes)
      .innerJoin(printers, eq(printers.id, printRoutes.printerId))
      .where(inArray(printRoutes.categoryId, categories))
      .orderBy(desc(printRoutes.priority));

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
  const [job] = await client
    .insert(printJobs)
    .values({
      printerId: input.printerId,
      comandaId: input.comandaId ?? null,
      comandaItemId: input.comandaItemId ?? null,
      kind: input.kind,
      payload: input.payload,
    })
    .returning({ id: printJobs.id });
  if (!job) throw new Error('Failed to enqueue print job');
  return job.id;
}
