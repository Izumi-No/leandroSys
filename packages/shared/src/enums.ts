/** Enums espelhados do contract do Prisma (apps/api/src/prisma/contract.prisma). */

export type Role = 'ADMIN' | 'WAITER' | 'CASHIER' | 'CHEF';

export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED';

export type ComandaStatus = 'OPEN' | 'PAYING' | 'CLOSED';

export type PaymentMethod = 'MONEY' | 'CARD' | 'PIX' | 'OTHER';

export type ItemStatus = 'PENDING' | 'SENT' | 'IN_PREP' | 'READY' | 'SERVED' | 'CANCELED';

export type PrintJobKind = 'ITEM' | 'BILL' | 'TEST';

export type PrintJobStatus = 'PENDING' | 'PRINTING' | 'DONE' | 'FAILED' | 'CANCELED';

export type PrinterTransport = 'BLUETOOTH' | 'USB' | 'NETWORK';

export const ROLES: readonly Role[] = ['ADMIN', 'WAITER', 'CASHIER', 'CHEF'];
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['MONEY', 'CARD', 'PIX', 'OTHER'];
export const PRINT_JOB_STATUSES: readonly PrintJobStatus[] = [
  'PENDING',
  'PRINTING',
  'DONE',
  'FAILED',
  'CANCELED',
];
