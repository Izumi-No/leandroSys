import 'dotenv/config';
import { hashPassword } from '../lib/password';
import { db } from '../prisma/db';

/**
 * Seed idempotente: só cria o que ainda não existe.
 * Rode com `pnpm seed`.
 */

async function ensureUser(username: string, password: string, role: 'ADMIN' | 'WAITER' | 'CASHIER' | 'CHEF') {
  const existing = await db.selectFrom('User').selectAll().where('username', '=', username).executeTakeFirst();
  if (existing) return null;
  await db
    .insertInto('User')
    .values({ username, password: await hashPassword(password), role })
    .execute();
  return username;
}

async function ensureCategory(name: string) {
  const existing = await db.selectFrom('Category').selectAll().where('name', '=', name).executeTakeFirst();
  if (existing) return existing;
  return db
    .insertInto('Category')
    .values({ name, active: true })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function ensureProduct(name: string, price: number, categoryId: string) {
  const existing = await db.selectFrom('Product').selectAll().where('name', '=', name).executeTakeFirst();
  if (existing) return existing;
  return db
    .insertInto('Product')
    .values({ name, price: price.toFixed(2), categoryId, active: true })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function ensureAditional(name: string, price: number) {
  const existing = await db.selectFrom('Aditional').selectAll().where('name', '=', name).executeTakeFirst();
  if (existing) return existing;
  return db
    .insertInto('Aditional')
    .values({ name, price: price.toFixed(2), active: true })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function ensurePrinter(input: {
  name: string;
  address: string;
  columns?: number;
  printsBill?: boolean;
}) {
  const existing = await db.selectFrom('Printer').selectAll().where('name', '=', input.name).executeTakeFirst();
  if (existing) return existing;

  return db
    .insertInto('Printer')
    .values({
      name: input.name,
      address: input.address,
      transport: 'BLUETOOTH',
      columns: input.columns ?? 32,
      codepage: 19,
      active: true,
      printsBill: false,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function ensureRoute(input: { printerId: string; productId?: string; categoryId?: string; priority?: number }) {
  const existing = input.productId
    ? await db
        .selectFrom('PrintRoute')
        .select(['id'])
        .where('printerId', '=', input.printerId)
        .where('productId', '=', input.productId)
        .executeTakeFirst()
    : await db
        .selectFrom('PrintRoute')
        .select(['id'])
        .where('printerId', '=', input.printerId)
        .where('categoryId', '=', input.categoryId ?? '')
        .executeTakeFirst();
  if (existing) return;

  await db
    .insertInto('PrintRoute')
    .values({
      printerId: input.printerId,
      productId: input.productId ?? null,
      categoryId: input.categoryId ?? null,
      priority: input.priority ?? 0,
    })
    .execute();
}

async function ensureTable(number: number, capacity = 4) {
  const existing = await db.selectFrom('Table').select(['id']).where('number', '=', number).executeTakeFirst();
  if (existing) return;
  await db
    .insertInto('Table')
    .values({ number, capacity, label: null, status: 'AVAILABLE' })
    .execute();
}

async function main(): Promise<void> {
  const created: string[] = [];

  // Usuários (troque as senhas em produção)
  for (const [username, password, role] of [
    ['admin', 'admin123', 'ADMIN'],
    ['garcom', 'garcom123', 'WAITER'],
    ['caixa', 'caixa123', 'CASHIER'],
    ['cozinha', 'cozinha123', 'CHEF'],
    ['impressora', 'impressora123', 'CHEF'], // cliente Electron que drena a fila
  ] as const) {
    const name = await ensureUser(username, password, role);
    if (name) created.push(`user:${name}`);
  }

  // Cardápio
  const lanches = await ensureCategory('Lanches');
  const porcoes = await ensureCategory('Porções');
  const bebidas = await ensureCategory('Bebidas');
  const pratos = await ensureCategory('Pratos');
  const sobremesas = await ensureCategory('Sobremesas');

  const products: Record<string, string> = {};
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
    products[name] = product.id;
  }

  await ensureAditional('Queijo extra', 3);
  await ensureAditional('Bacon', 4.5);
  await ensureAditional('Sem cebola', 0);

  // Impressoras (MAC bluetooth de exemplo — ajuste no admin)
  const cozinha = await ensurePrinter({ name: 'Cozinha', address: 'AA:BB:CC:11:22:31' });
  const balcao = await ensurePrinter({ name: 'Balcão', address: 'AA:BB:CC:11:22:32', printsBill: true });
  const bar = await ensurePrinter({ name: 'Bar', address: 'AA:BB:CC:11:22:33' });

  if (balcao.printsBill === false) {
    await db.updateTable('Printer').set({ printsBill: true }).where('id', '=', balcao.id).execute();
    created.push('printer:Balcão (destino de contas)');
  }

  // Rotas por categoria...
  await ensureRoute({ printerId: cozinha.id, categoryId: lanches.id });
  await ensureRoute({ printerId: cozinha.id, categoryId: porcoes.id });
  await ensureRoute({ printerId: cozinha.id, categoryId: pratos.id });
  await ensureRoute({ printerId: balcao.id, categoryId: bebidas.id });

  // ...e uma rota por item, que vence a rota de categoria:
  // Café Expresso sai pelo Bar, mesmo estando em Bebidas (que é do Balcão).
  await ensureRoute({ printerId: bar.id, productId: products['Café Expresso'] });

  // Mesas
  for (let number = 1; number <= 10; number += 1) await ensureTable(number);

  console.log('Seed concluído.');
  console.log(`  criados agora: ${created.length > 0 ? created.join(', ') : '(nenhum — já existia)'}`);
  console.log('  login admin/admin123 — cliente de impressão: impressora/impressora123');

  await db.destroy();
}

main().catch(async (error) => {
  console.error('Falha no seed:', error);
  await db.destroy();
  process.exit(1);
});
