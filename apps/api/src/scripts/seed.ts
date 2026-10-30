import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { hashPassword } from '../lib/password';
import { createDatabase } from '../db';
import { aditionals, categories, diningTables, printRoutes, printers, products, users } from '../db/schema';

const { db, close } = createDatabase();

/**
 * Seed idempotente: só cria o que ainda não existe.
 * Rode com `pnpm seed`.
 */

async function ensureUser(username: string, password: string, role: 'ADMIN' | 'WAITER' | 'CASHIER' | 'CHEF') {
  const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (existing) return null;
  await db.insert(users).values({ username, password: await hashPassword(password), role });
  return username;
}

async function ensureCategory(name: string) {
  const [existing] = await db.select().from(categories).where(eq(categories.name, name)).limit(1);
  if (existing) return existing;
  const [category] = await db.insert(categories).values({ name, active: true }).returning();
  return category;
}

async function ensureProduct(name: string, price: number, categoryId: string) {
  const [existing] = await db.select().from(products).where(eq(products.name, name)).limit(1);
  if (existing) return existing;
  const [product] = await db
    .insert(products)
    .values({ name, price: price.toFixed(2), categoryId, active: true })
    .returning();
  return product;
}

async function ensureAditional(name: string, price: number) {
  const [existing] = await db.select().from(aditionals).where(eq(aditionals.name, name)).limit(1);
  if (existing) return existing;
  const [aditional] = await db
    .insert(aditionals)
    .values({ name, price: price.toFixed(2), active: true })
    .returning();
  return aditional;
}

async function ensurePrinter(input: {
  name: string;
  address: string;
  columns?: number;
  printsBill?: boolean;
}) {
  const [existing] = await db.select().from(printers).where(eq(printers.name, input.name)).limit(1);
  if (existing) return existing;

  const [printer] = await db
    .insert(printers)
    .values({
      name: input.name,
      address: input.address,
      transport: 'BLUETOOTH',
      columns: input.columns ?? 32,
      codepage: 19,
      active: true,
      printsBill: false,
    })
    .returning();
  return printer;
}

async function ensureRoute(input: { printerId: string; productId?: string; categoryId?: string; priority?: number }) {
  const condition = input.productId
    ? and(eq(printRoutes.printerId, input.printerId), eq(printRoutes.productId, input.productId))
    : and(eq(printRoutes.printerId, input.printerId), eq(printRoutes.categoryId, input.categoryId ?? ''));
  const [existing] = await db.select({ id: printRoutes.id }).from(printRoutes).where(condition).limit(1);
  if (existing) return;

  await db.insert(printRoutes).values({
    printerId: input.printerId,
    productId: input.productId ?? null,
    categoryId: input.categoryId ?? null,
    priority: input.priority ?? 0,
  });
}

async function ensureTable(number: number, capacity = 4) {
  const [existing] = await db.select({ id: diningTables.id }).from(diningTables).where(eq(diningTables.number, number)).limit(1);
  if (existing) return;
  await db.insert(diningTables).values({ number, capacity, label: null, status: 'AVAILABLE' });
}

async function main(): Promise<void> {
  const created: string[] = [];

  for (const [username, password, role] of [
    ['admin', 'admin123', 'ADMIN'],
    ['garcom', 'garcom123', 'WAITER'],
    ['caixa', 'caixa123', 'CASHIER'],
    ['cozinha', 'cozinha123', 'CHEF'],
    ['impressora', 'impressora123', 'CHEF'],
  ] as const) {
    const name = await ensureUser(username, password, role);
    if (name) created.push(`user:${name}`);
  }

  const lanches = await ensureCategory('Lanches');
  const porcoes = await ensureCategory('Porções');
  const bebidas = await ensureCategory('Bebidas');
  const pratos = await ensureCategory('Pratos');
  const sobremesas = await ensureCategory('Sobremesas');

  const productsByName: Record<string, string> = {};
  const productDefs: [string, number, string][] = [
    ['X-Burguer', 18.9, lanches.id],
    ['X-Salada', 21.9, lanches.id],
    ['X-Bacon', 24.9, lanches.id],
    ['Batata Frita (P)', 14.9, porcoes.id],
    ['Batata Frita (G)', 22.9, porcoes.id],
    ['Refrigerante Lata', 6.5, bebidas.id],
    ['Suco Natural', 9.9, bebidas.id],
    ['Café Expresso', 4.5, bebidas.id],
    ['Parmegiana', 38.9, pratos.id],
    ['Strogonoff', 34.9, pratos.id],
    ['Pudim', 12.9, sobremesas.id],
  ];

  for (const [name, price, categoryId] of productDefs) {
    const product = await ensureProduct(name, price, categoryId);
    productsByName[name] = product.id;
  }

  await ensureAditional('Queijo extra', 3);
  await ensureAditional('Bacon', 4.5);
  await ensureAditional('Sem cebola', 0);

  const cozinha = await ensurePrinter({ name: 'Cozinha', address: 'AA:BB:CC:11:22:31' });
  const balcao = await ensurePrinter({ name: 'Balcão', address: 'AA:BB:CC:11:22:32', printsBill: true });
  const bar = await ensurePrinter({ name: 'Bar', address: 'AA:BB:CC:11:22:33' });

  if (balcao.printsBill === false) {
    await db.update(printers).set({ printsBill: true }).where(eq(printers.id, balcao.id));
    created.push('printer:Balcão (destino de contas)');
  }

  await ensureRoute({ printerId: cozinha.id, categoryId: lanches.id });
  await ensureRoute({ printerId: cozinha.id, categoryId: porcoes.id });
  await ensureRoute({ printerId: cozinha.id, categoryId: pratos.id });
  await ensureRoute({ printerId: balcao.id, categoryId: bebidas.id });
  await ensureRoute({ printerId: bar.id, productId: productsByName['Café Expresso'] });

  for (let number = 1; number <= 10; number += 1) await ensureTable(number);

  console.log('Seed concluído.');
  console.log(`  criados agora: ${created.length > 0 ? created.join(', ') : '(nenhum — já existia)'}`);
  console.log('  login admin/admin123 — cliente de impressão: impressora/impressora123');
}

main()
  .catch((error) => {
    console.error('Falha no seed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close();
  });
