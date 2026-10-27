import 'dotenv/config';
import { hashPassword } from '../lib/password';
import { db } from '../prisma/db';

/**
 * Seed idempotente: só cria o que ainda não existe.
 * Rode com `pnpm seed`.
 */

async function ensureUser(username: string, password: string, role: 'ADMIN' | 'WAITER' | 'CASHIER' | 'CHEF') {
  const existing = await db.orm.public.User.where({ username }).first();
  if (existing) return null;
  await db.orm.public.User.create({ username, password: await hashPassword(password), role });
  return username;
}

async function ensureCategory(name: string) {
  const existing = await db.orm.public.Category.where({ name }).first();
  return existing ?? (await db.orm.public.Category.create({ name, active: true }));
}

async function ensureProduct(name: string, price: number, categoryId: string) {
  const existing = await db.orm.public.Product.where({ name }).first();
  return existing ?? (await db.orm.public.Product.create({ name, price: price.toFixed(2), categoryId, active: true }));
}

async function ensureAditional(name: string, price: number) {
  const existing = await db.orm.public.Aditional.where({ name }).first();
  return existing ?? (await db.orm.public.Aditional.create({ name, price: price.toFixed(2), active: true }));
}

async function ensurePrinter(input: {
  name: string;
  address: string;
  columns?: number;
  printsBill?: boolean;
}) {
  const existing = await db.orm.public.Printer.where({ name: input.name }).first();
  if (existing) return existing;

  return db.orm.public.Printer.create({
    name: input.name,
    address: input.address,
    transport: 'BLUETOOTH',
    columns: input.columns ?? 32,
    codepage: 19,
    active: true,
    printsBill: false,
  });
}

async function ensureRoute(input: { printerId: string; productId?: string; categoryId?: string; priority?: number }) {
  const existing = input.productId
    ? await db.orm.public.PrintRoute.where({ printerId: input.printerId, productId: input.productId }).first()
    : await db.orm.public.PrintRoute.where({ printerId: input.printerId, categoryId: input.categoryId }).first();
  if (existing) return;

  await db.orm.public.PrintRoute.create({
    printerId: input.printerId,
    productId: input.productId ?? null,
    categoryId: input.categoryId ?? null,
    priority: input.priority ?? 0,
  });
}

async function ensureTable(number: number, capacity = 4) {
  const existing = await db.orm.public.Table.where({ number }).first();
  if (existing) return;
  await db.orm.public.Table.create({ number, capacity, label: null, status: 'AVAILABLE' });
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
  await ensureCategory('Sobremesas');

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
    ['Pudim', 12.9, await ensureCategory('Sobremesas').then((c) => c.id)],
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
    await db.orm.public.Printer.where({ id: balcao.id }).update({ printsBill: true });
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

  await db.close();
}

main().catch(async (error) => {
  console.error('Falha no seed:', error);
  await db.close();
  process.exit(1);
});
