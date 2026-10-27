import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../../lib/auth';
import { conflict, notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import { parseBody, parseParams, parseQuery } from '../../lib/validate';
import { db } from '../../prisma/db';

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

export const catalogRoutes = new Hono();

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

catalogRoutes.get('/categories', requireAuth, async (c) => {
  const [categories, products] = await Promise.all([
    db.selectFrom('Category').selectAll().orderBy('name', 'asc').execute(),
    db.selectFrom('Product').selectAll().where('active', '=', true).orderBy('name', 'asc').execute(),
  ]);

  const byCategory = new Map<string, typeof products>();
  for (const product of products) {
    const list = byCategory.get(product.categoryId) ?? [];
    list.push(product);
    byCategory.set(product.categoryId, list);
  }

  return c.json({
    categories: categories.map((category) => ({
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
  const category = await db
    .insertInto('Category')
    .values({ name: body.name, active: body.active ?? true })
    .returningAll()
    .executeTakeFirstOrThrow();
  return c.json({ category: { id: category.id, name: category.name, active: category.active } }, 201);
});

catalogRoutes.patch('/categories/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, categorySchema.partial());

  const existing = await db.selectFrom('Category').selectAll().where('id', '=', id).executeTakeFirst();
  if (!existing) throw notFound('Categoria não encontrada');

  const patch: { name?: string; active?: boolean } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.active !== undefined) patch.active = body.active;

  const updated = await db
    .updateTable('Category')
    .set(patch)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst();
  if (!updated) throw notFound('Categoria não encontrada');
  return c.json({ category: { id: updated.id, name: updated.name, active: updated.active } });
});

catalogRoutes.delete('/categories/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);

  const category = await db.selectFrom('Category').selectAll().where('id', '=', id).executeTakeFirst();
  if (!category) throw notFound('Categoria não encontrada');

  const products = await db.selectFrom('Product').select(['id']).where('categoryId', '=', id).execute();
  if (products.length > 0) throw conflict('Categoria possui produtos vinculados');

  await db.deleteFrom('Category').where('id', '=', id).execute();
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------

catalogRoutes.get('/products', requireAuth, async (c) => {
  const query = parseQuery(c, listQuery);

  let productQuery = db
    .selectFrom('Product')
    .innerJoin('Category', 'Category.id', 'Product.categoryId')
    .select([
      'Product.id as id',
      'Product.name as name',
      'Product.price as price',
      'Product.active as active',
      'Category.id as categoryId',
      'Category.name as categoryName',
    ]);
  if (query.categoryId) productQuery = productQuery.where('Product.categoryId', '=', query.categoryId);
  if (query.includeInactive !== 'true') productQuery = productQuery.where('Product.active', '=', true);

  const products = await productQuery.orderBy('Product.name', 'asc').execute();

  return c.json({
    products: products.map((product) => ({
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

  const category = await db.selectFrom('Category').selectAll().where('id', '=', body.categoryId).executeTakeFirst();
  if (!category) throw notFound('Categoria não encontrada');

  const product = await db
    .insertInto('Product')
    .values({
      name: body.name,
      price: body.price.toFixed(2),
      categoryId: category.id,
      active: body.active ?? true,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return c.json(
    { product: { id: product.id, name: product.name, price: money(product.price), categoryId: product.categoryId } },
    201,
  );
});

catalogRoutes.patch('/products/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, productPatchSchema);

  const existing = await db.selectFrom('Product').selectAll().where('id', '=', id).executeTakeFirst();
  if (!existing) throw notFound('Produto não encontrado');

  if (body.categoryId) {
    const category = await db.selectFrom('Category').selectAll().where('id', '=', body.categoryId).executeTakeFirst();
    if (!category) throw notFound('Categoria não encontrada');
  }

  const patch: { name?: string; price?: string; categoryId?: string; active?: boolean } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.price !== undefined) patch.price = body.price.toFixed(2);
  if (body.categoryId !== undefined) patch.categoryId = body.categoryId;
  if (body.active !== undefined) patch.active = body.active;
  if (Object.keys(patch).length === 0) throw conflict('Nada para atualizar');

  const updated = await db.updateTable('Product').set(patch).where('id', '=', id).returningAll().executeTakeFirst();
  if (!updated) throw notFound('Produto não encontrado');
  return c.json({
    product: { id: updated.id, name: updated.name, price: money(updated.price), active: updated.active },
  });
});

catalogRoutes.delete('/products/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);

  const product = await db.selectFrom('Product').selectAll().where('id', '=', id).executeTakeFirst();
  if (!product) throw notFound('Produto não encontrado');

  const items = await db.selectFrom('ComandaItem').select(['id']).where('productId', '=', id).execute();
  if (items.length > 0) throw conflict('Produto possui histórico em comandas; desative-o em vez de apagar');

  await db.deleteFrom('Product').where('id', '=', id).execute();
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Adicionais
// ---------------------------------------------------------------------------

catalogRoutes.get('/aditionals', requireAuth, async (c) => {
  const aditionals = await db.selectFrom('Aditional').selectAll().orderBy('name', 'asc').execute();

  return c.json({
    aditionals: aditionals.map((aditional) => ({
      id: aditional.id,
      name: aditional.name,
      price: money(aditional.price),
      active: aditional.active,
    })),
  });
});

catalogRoutes.post('/aditionals', requireAdmin(), async (c) => {
  const body = await parseBody(c, aditionalSchema);

  const aditional = await db
    .insertInto('Aditional')
    .values({
      name: body.name,
      price: body.price.toFixed(2),
      active: body.active ?? true,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return c.json(
    { aditional: { id: aditional.id, name: aditional.name, price: money(aditional.price) } },
    201,
  );
});

catalogRoutes.patch('/aditionals/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, aditionalPatchSchema);

  const existing = await db.selectFrom('Aditional').selectAll().where('id', '=', id).executeTakeFirst();
  if (!existing) throw notFound('Adicional não encontrado');

  const patch: { name?: string; price?: string; active?: boolean } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.price !== undefined) patch.price = body.price.toFixed(2);
  if (body.active !== undefined) patch.active = body.active;
  if (Object.keys(patch).length === 0) throw conflict('Nada para atualizar');

  const updated = await db.updateTable('Aditional').set(patch).where('id', '=', id).returningAll().executeTakeFirst();
  if (!updated) throw notFound('Adicional não encontrado');
  return c.json({
    aditional: { id: updated.id, name: updated.name, price: money(updated.price), active: updated.active },
  });
});

catalogRoutes.delete('/aditionals/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);

  const aditional = await db.selectFrom('Aditional').selectAll().where('id', '=', id).executeTakeFirst();
  if (!aditional) throw notFound('Adicional não encontrado');

  const used = await db.selectFrom('ComandaItemAditional').select(['aditionalId']).where('aditionalId', '=', id).execute();
  if (used.length > 0) throw conflict('Adicional já foi usado em comandas; desative-o');

  await db.deleteFrom('Aditional').where('id', '=', id).execute();
  return c.json({ deleted: true });
});
