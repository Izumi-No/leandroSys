/** Rótulos em pt-BR para os enums do domínio. */

import type {
  ComandaStatus,
  ItemStatus,
  PaymentMethod,
  PrintJobKind,
  PrintJobStatus,
  PrinterTransport,
  Role,
  TableStatus,
} from '@leandrosys/shared';

export const ROTULO_MESA: Record<TableStatus, string> = {
  AVAILABLE: 'Livre',
  OCCUPIED: 'Ocupada',
  RESERVED: 'Reservada',
};

export const ROTULO_COMANDA: Record<ComandaStatus, string> = {
  OPEN: 'Aberta',
  PAYING: 'Pagando',
  CLOSED: 'Fechada',
};

export const ROTULO_ITEM: Record<ItemStatus, string> = {
  PENDING: 'Pendente',
  SENT: 'Enviado',
  IN_PREP: 'Em preparo',
  READY: 'Pronto',
  SERVED: 'Servido',
  CANCELED: 'Cancelado',
};

export const ROTULO_PAGAMENTO: Record<PaymentMethod, string> = {
  MONEY: 'Dinheiro',
  CARD: 'Cartão',
  PIX: 'Pix',
  OTHER: 'Outro',
};

export const ROTULO_PAPEL: Record<Role, string> = {
  ADMIN: 'Administrador',
  WAITER: 'Garçom',
  CASHIER: 'Caixa',
  CHEF: 'Cozinha',
};

export const ROTULO_JOB: Record<PrintJobStatus, string> = {
  PENDING: 'Na fila',
  PRINTING: 'Imprimindo',
  DONE: 'Concluído',
  FAILED: 'Falhou',
  CANCELED: 'Cancelado',
};

export const ROTULO_TIPO_JOB: Record<PrintJobKind, string> = {
  ITEM: 'Item',
  BILL: 'Conta',
  TEST: 'Teste',
};

export const ROTULO_TRANSPORTE: Record<PrinterTransport, string> = {
  BLUETOOTH: 'Bluetooth',
  USB: 'USB',
  NETWORK: 'Rede',
};

/** Classe Tailwind (tokens semânticos) para o badge de cada estado. */
export const TOM_MESA: Record<TableStatus, string> = {
  AVAILABLE: 'bg-secondary text-secondary-foreground',
  OCCUPIED: 'bg-primary text-primary-foreground',
  RESERVED: 'bg-accent text-accent-foreground',
};

export const TOM_COMANDA: Record<ComandaStatus, string> = {
  OPEN: 'bg-primary text-primary-foreground',
  PAYING: 'bg-accent text-accent-foreground',
  CLOSED: 'bg-muted text-muted-foreground',
};

export const TOM_ITEM: Record<ItemStatus, string> = {
  PENDING: 'bg-accent text-accent-foreground',
  SENT: 'bg-primary text-primary-foreground',
  IN_PREP: 'bg-primary/85 text-primary-foreground',
  READY: 'bg-secondary text-secondary-foreground',
  SERVED: 'bg-muted text-muted-foreground',
  CANCELED: 'bg-destructive/12 text-destructive',
};

export const TOM_JOB: Record<PrintJobStatus, string> = {
  PENDING: 'bg-accent text-accent-foreground',
  PRINTING: 'bg-primary text-primary-foreground',
  DONE: 'bg-secondary text-secondary-foreground',
  FAILED: 'bg-destructive/12 text-destructive',
  CANCELED: 'bg-muted text-muted-foreground',
};
