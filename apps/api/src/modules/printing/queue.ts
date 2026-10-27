import { db } from '../../prisma/db';
import type { TicketDoc } from './escpos';

/**
 * Qualquer contexto de consulta serve aqui: o client global (`db`) ou o `tx`
 * de uma transação — ambos expõem `orm`, `sql`, `query` e `execute`.
 */
export type DbLike = Pick<typeof db, 'orm' | 'sql' | 'query' | 'execute'>;

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

const toRoutedPrinter = (printer: {
  id: string;
  name: string;
  columns: number;
  codepage: number;
  active: boolean;
}): RoutedPrinter | null =>
  printer.active
    ? { id: printer.id, name: printer.name, columns: printer.columns, codepage: printer.codepage }
    : null;

const push = (map: Map<string, RoutedPrinter[]>, key: string, printer: RoutedPrinter | null): void => {
  if (!printer) return;
  const current = map.get(key);
  if (current) current.push(printer);
  else map.set(key, [printer]);
};

/**
 * Carrega as rotas de impressão para os produtos/categorias informados.
 * Rotas por **item** têm prioridade sobre rotas por **categoria** (resolvido
 * em `pickPrinters`); `priority` ordena impressoras dentro de cada grupo.
 */
export async function loadRouteMaps(
  client: DbLike,
  productIds: string[],
  categoryIds: string[],
): Promise<RouteMaps> {
  const products = [...new Set(productIds)];
  const categories = [...new Set(categoryIds)];

  const maps: RouteMaps = { byProduct: new Map(), byCategory: new Map() };

  if (products.length > 0) {
    const routes = await client.orm.public.PrintRoute
      .where((route) => route.productId.in(products))
      .include('printer')
      .orderBy((route) => route.priority.desc())
      .all();

    for (const route of routes) {
      if (!route.productId) continue;
      push(maps.byProduct, route.productId, toRoutedPrinter(route.printer));
    }
  }

  if (categories.length > 0) {
    const routes = await client.orm.public.PrintRoute
      .where((route) => route.categoryId.in(categories))
      .include('printer')
      .orderBy((route) => route.priority.desc())
      .all();

    for (const route of routes) {
      if (!route.categoryId) continue;
      push(maps.byCategory, route.categoryId, toRoutedPrinter(route.printer));
    }
  }

  return maps;
}

/** Rota por item vence rota por categoria; sem rota, devolve []. */
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

/** Enfileira um job na fila da impressora. */
export async function enqueueJob(client: DbLike, input: EnqueueInput): Promise<string> {
  const job = await client.orm.public.PrintJob.create({
    printerId: input.printerId,
    comandaId: input.comandaId ?? null,
    comandaItemId: input.comandaItemId ?? null,
    kind: input.kind,
    payload: input.payload as never,
  });
  return job.id;
}
