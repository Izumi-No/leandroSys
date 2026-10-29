import { pgTable, uuid, text, varchar, boolean, numeric, integer, timestamp, serial, jsonb, primaryKey } from 'drizzle-orm/pg-core';
import { pgEnum } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['ADMIN', 'WAITER', 'CASHIER', 'CHEF'] as const);
export const tableStatusEnum = pgEnum('table_status', ['AVAILABLE', 'OCCUPIED', 'RESERVED'] as const);
export const comandaStatusEnum = pgEnum('comanda_status', ['OPEN', 'PAYING', 'CLOSED'] as const);
export const paymentMethodEnum = pgEnum('payment_method', ['MONEY', 'CARD', 'PIX', 'OTHER'] as const);
export const itemStatusEnum = pgEnum('item_status', ['PENDING', 'SENT', 'IN_PREP', 'READY', 'SERVED', 'CANCELED'] as const);
export const printerTransportEnum = pgEnum('printer_transport', ['BLUETOOTH', 'USB', 'NETWORK'] as const);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  role: roleEnum('role'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  active: boolean('active').default(true).notNull(),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  categoryId: uuid('category_id').references(() => categories.id),
  active: boolean('active').default(true).notNull(),
});

export const tables = pgTable('tables', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: integer('number').notNull().unique(),
  capacity: integer('capacity').default(4).notNull(),
  label: text('label'),
  status: tableStatusEnum('status').default('AVAILABLE').notNull(),
});

export const comandas = pgTable('comandas', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: serial('number').unique().notNull(),
  tableId: uuid('table_id').notNull().references(() => tables.id),
  status: comandaStatusEnum('status').default('OPEN').notNull(),
  waiterId: uuid('waiter_id'),
  total: numeric('total', { precision: 10, scale: 2 }).default('0').notNull(),
  paymentMethod: paymentMethodEnum('payment_method'),
  openedAt: timestamp('opened_at').defaultNow().notNull(),
  closedAt: timestamp('closed_at'),
});

export const comandaItems = pgTable('comanda_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  comandaId: uuid('comanda_id').notNull().references(() => comandas.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id),
  quantity: integer('quantity').default(1).notNull(),
  unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
  note: text('note'),
  status: itemStatusEnum('status').default('PENDING').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const aditionals = pgTable('aditionals', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  categoryId: uuid('category_id'),
  productId: uuid('product_id'),
  active: boolean('active').default(true).notNull(),
});

export const comandaItemAditionals = pgTable('comanda_item_aditionals', {
  comandaItemId: uuid('comanda_item_id').notNull().references(() => comandaItems.id, { onDelete: 'cascade' }),
  aditionalId: uuid('aditional_id').notNull().references(() => aditionals.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey(table.comandaItemId, table.aditionalId),
}));

export const printers = pgTable('printers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  address: text('address').notNull(),
  transport: printerTransportEnum('transport').default('BLUETOOTH').notNull(),
  columns: integer('columns').default(32).notNull(),
  codepage: integer('codepage').default(19).notNull(),
  active: boolean('active').default(true).notNull(),
  printsBill: boolean('prints_bill').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  agentId: text('agent_id'),
  agentName: text('agent_name'),
  baud: integer('baud'),
  boundAt: timestamp('bound_at'),
});

export const printRoutes = pgTable('print_routes', {
  id: uuid('id').primaryKey().defaultRandom(),
  printerId: uuid('printer_id').notNull().references(() => printers.id, { onDelete: 'cascade' }),
  productId: uuid('product_id'),
  categoryId: uuid('category_id'),
});

export const printJobs = pgTable('print_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  // fields omitted for brevity – add as needed
});
