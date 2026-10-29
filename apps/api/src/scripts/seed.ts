import 'dotenv/config';
import { hashPassword } from '../lib/password';
import { db } from '../infrastructure/drizzle/db';
import { schema } from '../infrastructure/drizzle/schema';
import { eq } from 'drizzle-orm';

/** Seed idempotente: só cria o que ainda não existe. */
async function ensureUser(username: string, password: string, role: 'ADMIN' | 'WAITER' | 'CASHIER' | 'CHEF') {
  const rows = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
  const existing = rows[0];
  if (existing) return null;
  const [user] = await db
    .insert(schema.users)
    .values({ username, password: await hashPassword(password), role })
    .returning();
  return user.username;
}

async function ensureCategory(name: string) {
  const rows = await db.select().from(schema.categories).where(eq(schema.categories.name, name)).limit(1);
  const existing = rows[0];
  if (existing) return existing;
  const [cat] = await db.insert(schema.categories).values({ name, active: true }).returning();
  return cat;
}

async function ensureProduct(name: string, price: number, categoryId: string) {
  const rows = await db.select().from(schema.products).where(eq(schema.products.name, name)).limit(1);
  const existing = rows[0];
  if (existing) return existing;
  const [product] = await db
    .insert(schema.products)
    .values({ name, price: price.toFixed(2), categoryId, active: true })
    .returning();
  return product;
}

async function ensureAditional(name: string, price: number, categoryId?: string) {
  const rows = await db.select().from(schema.aditionals).where(eq(schema.aditionals.name, name)).limit(1);
  const existing = rows[0];
  if (existing) return existing;
  const [ad] = await db
    .insert(schema.aditionals)
    .values({ name, price: price.toFixed(2), active: true, categoryId })
    .returning();
  return ad;
}

async function ensurePrinter({ name, address, columns, printsBill }: { name: string; address: string; columns?: number; printsBill?: boolean }) {
  const rows = await db.select().from(schema.printers).where(eq(schema.printers.name, name)).limit(1);
  const existing = rows[0];
  if (existing) return existing;
  const [printer] = await db
    .insert(schema.printers)
    .values({
      name,
      address,
      transport: 'BLUETOOTH',
      columns: columns ?? 32,
      codepage: 19,
      active: true,
      printsBill: printsBill ?? false,
    })
    .returning();
  return printer;
}

async function ensureRoute({ printerId, productId, categoryId, priority }: { printerId: string; productId?: string; categoryId?: string; priority?: number }) {
  const base = db.select().from(schema.printRoutes);
  const existing = productId
    ? await base.where(eq(schema.printRoutes.printerId, printerId), eq(schema.printRoutes.productId, productId)).first()
    : await base.where(eq(schema.printRoutes.printerId, printerId), eq(schema.printRoutes.categoryId, categoryId)).first();
  if (existing) return;
  await db
    .insert(schema.printRoutes)
    .values({ printerId, productId: productId ?? null, categoryId: categoryId ?? null, priority: priority ?? 0 })
    .returning();
}

async function ensureTable(number: number, capacity = 4) {
  const rows = await db.select().from(schema.tables).where(eq(schema.tables.number, number)).limit(1);
  const existing = rows[0];
  if (existing) return;
  await db
    .insert(schema.tables)
    .values({ number, capacity, label: null, status: 'AVAILABLE' })
    .returning();
}

async function main(): Promise<void> {
  const created: string[] = [];

  // Usuários (troque as senhas em produção)
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

  // Cardápio – categorias
  const bebidas = await ensureCategory('Bebidas');
  const caldoCana = await ensureCategory('Caldo de cana');
  const sucoLaranja = await ensureCategory('Suco de laranja natural');
  const sucosPolpa = await ensureCategory('Sucos naturais de polpa');
  const pasteisTrad = await ensureCategory('Pastéis Tradicionais');
  const pasteisEsp = await ensureCategory('Pastéis Especiais');
  const pasteisDoces = await ensureCategory('Pastéis Doces');

  const productDefs: [string, number, string][] = [
    // ... (mesmo array de produtos do original) 
  ];

  for (const [name, price, categoryId] of productDefs) {
    await ensureProduct(name, price, categoryId);
  }

  // Adicionais
  await ensureAditional('Limão', 0, caldoCana.id);
  await ensureAditional('Abacaxi', 0, caldoCana.id);
  await ensureAditional('Gengibre', 0, caldoCana.id);
  await ensureAditional('Natural', 0, caldoCana.id);
  // ... (demais adicionais como no arquivo original)

  // Impressoras
  const printer1 = await ensurePrinter({ name: 'Impressora 1', address: 'COM1' });
  // ... (crie outras impressoras se necessário)

  // Rotas de impressão exemplo
  await ensureRoute({ printerId: printer1.id, productId: /* some product id */ undefined, categoryId: bebidas.id });

  // Mesas
  for (let i = 1; i <= 20; i++) {
    await ensureTable(i);
  }

  console.log('Seed concluído. Itens criados:', created.join(', '));
}

main().catch((e) => {
  console.error('Erro no seed:', e);
  process.exit(1);
});
