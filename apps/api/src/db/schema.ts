import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('Role', ['ADMIN', 'WAITER', 'CASHIER', 'CHEF']);
export const tableStatusEnum = pgEnum('TableStatus', ['AVAILABLE', 'OCCUPIED', 'RESERVED']);
export const comandaStatusEnum = pgEnum('ComandaStatus', ['OPEN', 'PAYING', 'CLOSED']);
export const paymentMethodEnum = pgEnum('PaymentMethod', ['MONEY', 'CARD', 'PIX', 'OTHER']);
export const itemStatusEnum = pgEnum('ItemStatus', ['PENDING', 'SENT', 'IN_PREP', 'READY', 'SERVED', 'CANCELED']);
export const printerTransportEnum = pgEnum('PrinterTransport', ['BLUETOOTH', 'USB', 'NETWORK']);
export const printJobStatusEnum = pgEnum('PrintJobStatus', ['PENDING', 'PRINTING', 'DONE', 'FAILED', 'CANCELED']);
export const printJobKindEnum = pgEnum('PrintJobKind', ['ITEM', 'COMANDA', 'BILL', 'TEST']);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('User', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  role: roleEnum('role').notNull(),
  createdAt: timestamptz('createdAt').notNull().defaultNow(),
});

export const categories = pgTable('Category', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  active: boolean('active').notNull().default(true),
});

export const products = pgTable('Product', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  price: numeric('price').notNull(),
  categoryId: uuid('categoryId').notNull().references(() => categories.id),
  active: boolean('active').notNull().default(true),
});

export const aditionals = pgTable('Aditional', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  price: numeric('price').notNull(),
  active: boolean('active').notNull().default(true),
});

export const diningTables = pgTable('Table', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: integer('number').notNull().unique(),
  capacity: integer('capacity').notNull().default(4),
  label: text('label'),
  status: tableStatusEnum('status').notNull().default('AVAILABLE'),
});

export const comandas = pgTable('Comanda', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: integer('number').notNull().generatedAlwaysAsIdentity().unique(),
  tableId: uuid('tableId').notNull().references(() => diningTables.id),
  status: comandaStatusEnum('status').notNull().default('OPEN'),
  waiterId: uuid('waiterId').references(() => users.id),
  total: numeric('total').notNull().default('0'),
  paymentMethod: paymentMethodEnum('paymentMethod'),
  openedAt: timestamptz('openedAt').notNull().defaultNow(),
  closedAt: timestamptz('closedAt'),
});

export const comandaItems = pgTable('ComandaItem', {
  id: uuid('id').primaryKey().defaultRandom(),
  comandaId: uuid('comandaId').notNull().references(() => comandas.id, { onDelete: 'cascade' }),
  productId: uuid('productId').notNull().references(() => products.id),
  quantity: integer('quantity').notNull().default(1),
  unitPrice: numeric('unitPrice').notNull(),
  note: text('note'),
  status: itemStatusEnum('status').notNull().default('PENDING'),
  createdAt: timestamptz('createdAt').notNull().defaultNow(),
});

export const comandaItemAditionals = pgTable(
  'ComandaItemAditional',
  {
    comandaItemId: uuid('comandaItemId').notNull().references(() => comandaItems.id, { onDelete: 'cascade' }),
    aditionalId: uuid('aditionalId').notNull().references(() => aditionals.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.comandaItemId, table.aditionalId] }),
    index('ComandaItemAditional_aditionalId_idx').on(table.aditionalId),
  ],
);

export const printers = pgTable(
  'Printer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    address: text('address').notNull(),
    transport: printerTransportEnum('transport').notNull().default('BLUETOOTH'),
    columns: integer('columns').notNull().default(32),
    codepage: integer('codepage').notNull().default(19),
    active: boolean('active').notNull().default(true),
    printsBill: boolean('printsBill').notNull().default(false),
    createdAt: timestamptz('createdAt').notNull().defaultNow(),
    agentId: text('agentId'),
    agentName: text('agentName'),
    baud: integer('baud'),
    boundAt: timestamptz('boundAt'),
  },
  (table) => [index('Printer_agentId_idx').on(table.agentId)],
);

export const printRoutes = pgTable(
  'PrintRoute',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    printerId: uuid('printerId').notNull().references(() => printers.id, { onDelete: 'cascade' }),
    productId: uuid('productId').references(() => products.id, { onDelete: 'cascade' }),
    categoryId: uuid('categoryId').references(() => categories.id, { onDelete: 'cascade' }),
    priority: integer('priority').notNull().default(0),
    createdAt: timestamptz('createdAt').notNull().defaultNow(),
  },
  (table) => [
    index('PrintRoute_productId_idx').on(table.productId),
    index('PrintRoute_categoryId_idx').on(table.categoryId),
    index('PrintRoute_printerId_idx').on(table.printerId),
  ],
);

export const printJobs = pgTable(
  'PrintJob',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    printerId: uuid('printerId').notNull().references(() => printers.id, { onDelete: 'cascade' }),
    comandaId: uuid('comandaId').references(() => comandas.id, { onDelete: 'set null' }),
    comandaItemId: uuid('comandaItemId').references(() => comandaItems.id, { onDelete: 'cascade' }),
    kind: printJobKindEnum('kind').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    status: printJobStatusEnum('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('lastError'),
    createdAt: timestamptz('createdAt').notNull().defaultNow(),
    claimedAt: timestamptz('claimedAt'),
    finishedAt: timestamptz('finishedAt'),
  },
  (table) => [
    index('PrintJob_printerId_status_idx').on(table.printerId, table.status),
    index('PrintJob_comandaId_idx').on(table.comandaId),
  ],
);
