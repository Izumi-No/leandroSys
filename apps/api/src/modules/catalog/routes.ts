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
  const categories = await db.orm.public.Category
    .orderBy((category) => category.name.asc())
    .include('products', (products) =>
      products
        .where((product) => product.active.eq(true))
        .orderBy((product) => product.name.asc()),
    )
    .all();

  return c.json({
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      active: category.active,
      products: category.products.map((product) => ({
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
  const category = await db.orm.public.Category.create({
    name: body.name,
    active: body.active ?? true,
  });
  return c.json({ category: { id: category.id, name: category.name, active: category.active } }, 201);
});

catalogRoutes.patch('/categories/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, categorySchema.partial());

  const existing = await db.orm.public.Category.first({ id });
  if (!existing) throw notFound('Categoria não encontrada');

  const patch: { name?: string; active?: boolean } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.active !== undefined) patch.active = body.active;

  const updated = await db.orm.public.Category.where({ id }).update(patch);
  if (!updated) throw notFound('Categoria não encontrada');
  return c.json({ category: { id: updated.id, name: updated.name, active: updated.active } });
});

catalogRoutes.delete('/categories/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);

  const category = await db.orm.public.Category.first({ id });
  if (!category) throw notFound('Categoria não encontrada');

  const products = await db.orm.public.Product.where({ categoryId: id }).all();
  if (products.length > 0) throw conflict('Categoria possui produtos vinculados');

  await db.orm.public.Category.where({ id }).delete();
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------

catalogRoutes.get('/products', requireAuth, async (c) => {
  const query = parseQuery(c, listQuery);

  const base = query.categoryId
    ? db.orm.public.Product.where({ categoryId: query.categoryId })
    : db.orm.public.Product;

  const filtered = query.includeInactive === 'true' ? base : base.where((product) => product.active.eq(true));

  const products = await filtered.orderBy((product) => product.name.asc()).include('category').all();

  return c.json({
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      price: money(product.price),
      active: product.active,
      category: { id: product.category.id, name: product.category.name },
    })),
  });
});

catalogRoutes.post('/products', requireAdmin(), async (c) => {
  const body = await parseBody(c, productSchema);

  const category = await db.orm.public.Category.first({ id: body.categoryId });
  if (!category) throw notFound('Categoria não encontrada');

  const product = await db.orm.public.Product.create({
    name: body.name,
    price: body.price.toFixed(2),
    categoryId: category.id,
    active: body.active ?? true,
  });

  return c.json(
    { product: { id: product.id, name: product.name, price: money(product.price), categoryId: product.categoryId } },
    201,
  );
});

catalogRoutes.patch('/products/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, productPatchSchema);

  const existing = await db.orm.public.Product.first({ id });
  if (!existing) throw notFound('Produto não encontrado');

  if (body.categoryId) {
    const category = await db.orm.public.Category.first({ id: body.categoryId });
    if (!category) throw notFound('Categoria não encontrada');
  }

  const patch: { name?: string; price?: string; categoryId?: string; active?: boolean } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.price !== undefined) patch.price = body.price.toFixed(2);
  if (body.categoryId !== undefined) patch.categoryId = body.categoryId;
  if (body.active !== undefined) patch.active = body.active;
  if (Object.keys(patch).length === 0) throw conflict('Nada para atualizar');

  const updated = await db.orm.public.Product.where({ id }).update(patch);
  if (!updated) throw notFound('Produto não encontrado');
  return c.json({
    product: { id: updated.id, name: updated.name, price: money(updated.price), active: updated.active },
  });
});

catalogRoutes.delete('/products/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);

  const product = await db.orm.public.Product.first({ id });
  if (!product) throw notFound('Produto não encontrado');

  const items = await db.orm.public.ComandaItem.where({ productId: id }).all();
  if (items.length > 0) throw conflict('Produto possui histórico em comandas; desative-o em vez de apagar');

  await db.orm.public.Product.where({ id }).delete();
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Adicionais
// ---------------------------------------------------------------------------

catalogRoutes.get('/aditionals', requireAuth, async (c) => {
  const aditionals = await db.orm.public.Aditional
    .orderBy((aditional) => aditional.name.asc())
    .all();

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

  const aditional = await db.orm.public.Aditional.create({
    name: body.name,
    price: body.price.toFixed(2),
    active: body.active ?? true,
  });

  return c.json(
    { aditional: { id: aditional.id, name: aditional.name, price: money(aditional.price) } },
    201,
  );
});

catalogRoutes.patch('/aditionals/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);
  const body = await parseBody(c, aditionalPatchSchema);

  const existing = await db.orm.public.Aditional.first({ id });
  if (!existing) throw notFound('Adicional não encontrado');

  const patch: { name?: string; price?: string; active?: boolean } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.price !== undefined) patch.price = body.price.toFixed(2);
  if (body.active !== undefined) patch.active = body.active;
  if (Object.keys(patch).length === 0) throw conflict('Nada para atualizar');

  const updated = await db.orm.public.Aditional.where({ id }).update(patch);
  if (!updated) throw notFound('Adicional não encontrado');
  return c.json({
    aditional: { id: updated.id, name: updated.name, price: money(updated.price), active: updated.active },
  });
});

catalogRoutes.delete('/aditionals/:id', requireAdmin(), async (c) => {
  const { id } = parseParams(c, idParam);

  const aditional = await db.orm.public.Aditional.first({ id });
  if (!aditional) throw notFound('Adicional não encontrado');

  const used = await db.orm.public.ComandaItemAditional.where({ aditionalId: id }).all();
  if (used.length > 0) throw conflict('Adicional já foi usado em comandas; desative-o');

  await db.orm.public.Aditional.where({ id }).delete();
  return c.json({ deleted: true });
});
