import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../../lib/auth';
import type { AppEnv } from '../../lib/auth';
import { conflict, notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import { parseBody, parseParams, parseQuery } from '../../lib/validate';
import { aditionals, categories, comandaItemAditionals, comandaItems, products } from '../../db/schema';

const idParam = z.object({ id: z.uuid() });

const categorySchema = z.object({
  name: z.string().min(1).max(60),
  active: z.boolean().optional(),
});

const productSchema = z.object({
  name: z.string().min(1).max(80),
  price: z.number().nonnegative().max(99999),
  categoryId: z.uuid(),
  active: z.boolean().optional(),
});

const productPatchSchema = productSchema.partial();

const aditionalSchema = z.object({
  name: z.string().min(1).max(60),
  price: z.number().nonnegative().max(99999),
  active: z.boolean().optional(),
});

const aditionalPatchSchema = aditionalSchema.partial();

const listQuery = z.object({
  categoryId: z.uuid().optional(),
  includeInactive: z.string().optional(),
});

export const catalogRoutes = new Hono<AppEnv>();

catalogRoutes.get('/categories', requireAuth, async (c) => {
  const db = c.get('db');
  const [categoryRows, productRows] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.name)),
    db.select().from(products).where(eq(products.active, true)).orderBy(asc(products.name)),
  ]);

  const byCategory = new Map<string, typeof productRows>();
  for (const product of productRows) {
    const list = byCategory.get(product.categoryId) ?? [];
    list.push(product);
    byCategory.set(product.categoryId, list);
  }

  return c.json({
    categories: categoryRows.map((category) => ({
      id: category.id,
      name: category.name,
      active: category.active,
      products: (byCategory.get(category.id) ?? []).map((product) => ({
        id: product.id,
        name: product.name,
        price: money(product.price),
        active: product.active,
        categoryId: product.categoryId,
      })),
    })),
  });
});

catalogRoutes.post('/categories', requireAdmin(), async (c) => {
  const body = await parseBody(c, categorySchema);
  const [category] = await c
    .get('db')
    .insert(categories)
    .values({ name: body.name, active: body.active ?? true })
    .returning();
  return c.json({ category: { id: category.id, name: category.name, active: category.active } }, 201);
});

catalogRoutes.patch('/categories/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, categorySchema.partial());
  const db = c.get('db');

  const [existing] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  if (!existing) throw notFound('Categoria não encontrada');

  const patch: { name?: string; active?: boolean } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.active !== undefined) patch.active = body.active;

  const [updated] = await db.update(categories).set(patch).where(eq(categories.id, id)).returning();
  if (!updated) throw notFound('Categoria não encontrada');
  return c.json({ category: { id: updated.id, name: updated.name, active: updated.active } });
});

catalogRoutes.delete('/categories/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const db = c.get('db');

  const [category] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  if (!category) throw notFound('Categoria não encontrada');

  const productRows = await db.select({ id: products.id }).from(products).where(eq(products.categoryId, id));
  if (productRows.length > 0) throw conflict('Categoria possui produtos vinculados');

  await db.delete(categories).where(eq(categories.id, id));
  return c.json({ deleted: true });
});

catalogRoutes.get('/products', requireAuth, async (c) => {
  const query = parseQuery(c, listQuery);
  const conditions = [];
  if (query.categoryId) conditions.push(eq(products.categoryId, query.categoryId));
  if (query.includeInactive !== 'true') conditions.push(eq(products.active, true));

  const productsList = await c
    .get('db')
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      active: products.active,
      categoryId: categories.id,
      categoryName: categories.name,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(and(...conditions))
    .orderBy(asc(products.name));

  return c.json({
    products: productsList.map((product) => ({
      id: product.id,
      name: product.name,
      price: money(product.price),
      active: product.active,
      category: { id: product.categoryId, name: product.categoryName },
    })),
  });
});

catalogRoutes.post('/products', requireAdmin(), async (c) => {
  const body = await parseBody(c, productSchema);
  const db = c.get('db');

  const [category] = await db.select().from(categories).where(eq(categories.id, body.categoryId)).limit(1);
  if (!category) throw notFound('Categoria não encontrada');

  const [product] = await db
    .insert(products)
    .values({
      name: body.name,
      price: body.price.toFixed(2),
      categoryId: category.id,
      active: body.active ?? true,
    })
    .returning();

  return c.json(
    { product: { id: product.id, name: product.name, price: money(product.price), categoryId: product.categoryId } },
    201,
  );
});

catalogRoutes.patch('/products/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, productPatchSchema);
  const db = c.get('db');

  const [existing] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!existing) throw notFound('Produto não encontrado');

  if (body.categoryId) {
    const [category] = await db.select().from(categories).where(eq(categories.id, body.categoryId)).limit(1);
    if (!category) throw notFound('Categoria não encontrada');
  }

  const patch: { name?: string; price?: string; categoryId?: string; active?: boolean } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.price !== undefined) patch.price = body.price.toFixed(2);
  if (body.categoryId !== undefined) patch.categoryId = body.categoryId;
  if (body.active !== undefined) patch.active = body.active;
  if (Object.keys(patch).length === 0) throw conflict('Nada para atualizar');

  const [updated] = await db.update(products).set(patch).where(eq(products.id, id)).returning();
  if (!updated) throw notFound('Produto não encontrado');
  return c.json({
    product: { id: updated.id, name: updated.name, price: money(updated.price), active: updated.active },
  });
});

catalogRoutes.delete('/products/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const db = c.get('db');

  const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!product) throw notFound('Produto não encontrado');

  const items = await db.select({ id: comandaItems.id }).from(comandaItems).where(eq(comandaItems.productId, id));
  if (items.length > 0) throw conflict('Produto possui histórico em comandas; desative-o em vez de apagar');

  await db.delete(products).where(eq(products.id, id));
  return c.json({ deleted: true });
});

catalogRoutes.get('/aditionals', requireAuth, async (c) => {
  const rows = await c.get('db').select().from(aditionals).orderBy(asc(aditionals.name));

  return c.json({
    aditionals: rows.map((aditional) => ({
      id: aditional.id,
      name: aditional.name,
      price: money(aditional.price),
      active: aditional.active,
    })),
  });
});

catalogRoutes.post('/aditionals', requireAdmin(), async (c) => {
  const body = await parseBody(c, aditionalSchema);

  const [aditional] = await c
    .get('db')
    .insert(aditionals)
    .values({
      name: body.name,
      price: body.price.toFixed(2),
      active: body.active ?? true,
    })
    .returning();

  return c.json(
    { aditional: { id: aditional.id, name: aditional.name, price: money(aditional.price) } },
    201,
  );
});

catalogRoutes.patch('/aditionals/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, aditionalPatchSchema);
  const db = c.get('db');

  const [existing] = await db.select().from(aditionals).where(eq(aditionals.id, id)).limit(1);
  if (!existing) throw notFound('Adicional não encontrado');

  const patch: { name?: string; price?: string; active?: boolean } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.price !== undefined) patch.price = body.price.toFixed(2);
  if (body.active !== undefined) patch.active = body.active;
  if (Object.keys(patch).length === 0) throw conflict('Nada para atualizar');

  const [updated] = await db.update(aditionals).set(patch).where(eq(aditionals.id, id)).returning();
  if (!updated) throw notFound('Adicional não encontrado');
  return c.json({
    aditional: { id: updated.id, name: updated.name, price: money(updated.price), active: updated.active },
  });
});

catalogRoutes.delete('/aditionals/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const db = c.get('db');

  const [aditional] = await db.select().from(aditionals).where(eq(aditionals.id, id)).limit(1);
  if (!aditional) throw notFound('Adicional não encontrado');

  const used = await db
    .select({ aditionalId: comandaItemAditionals.aditionalId })
    .from(comandaItemAditionals)
    .where(eq(comandaItemAditionals.aditionalId, id));
  if (used.length > 0) throw conflict('Adicional já foi usado em comandas; desative-o');

  await db.delete(aditionals).where(eq(aditionals.id, id));
  return c.json({ deleted: true });
});
