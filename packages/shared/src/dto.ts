import type {
  ComandaStatus,
  ItemStatus,
  PaymentMethod,
  PrintJobKind,
  PrintJobStatus,
  PrinterTransport,
  Role,
  TableStatus,
} from './enums';

/** Corpo padrão de erro da API: `{ error, code, details? }`. */
export type ApiError = {
  error: string;
  code: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL';
  details?: { path: string; message: string }[];
};

/** `GET /api/health` */
export type HealthResponse = { ok: boolean; service: string; time: string };

/** `POST /api/auth/login` */
export type AuthUser = { id: string; username: string; role: Role };

export type LoginResponse = { token: string; user: AuthUser };

/** `GET /api/tables` — item do array `tables`. */
export type TableDTO = {
  id: string;
  number: number;
  capacity: number;
  label: string | null;
  status: TableStatus;
  comanda: {
    id: string;
    number: number;
    status: ComandaStatus;
    openedAt: string;
    waiter: AuthUser | null;
    total: string;
    itemCount: number;
    pendingItems: number;
  } | null;
};

/** Resumo de comanda (`GET /api/comandas` e dentro dos detalhes). */
export type ComandaSummaryDTO = {
  id: string;
  number: number;
  status: ComandaStatus;
  openedAt: string;
  closedAt: string | null;
  paymentMethod: PaymentMethod | null;
  total: string;
  table: { id: string; number: number };
  waiter: AuthUser | null;
  itemCount: number;
  pendingItems: number;
};

export type ComandaItemDTO = {
  id: string;
  status: ItemStatus;
  quantity: number;
  note: string | null;
  createdAt: string;
  unitPrice: string;
  total: string;
  canceled: boolean;
  product: { id: string; name: string; categoryId: string; category: string };
  aditionals: { id: string; name: string; price: string }[];
};

/** `GET /api/comandas/:id` — resumo + itens. */
export type ComandaDetailDTO = ComandaSummaryDTO & { items: ComandaItemDTO[] };

/** Item devolvido por `POST /api/print-jobs/claim` (bytes em base64). */
export type ClaimedPrintJob = {
  id: string;
  kind: PrintJobKind;
  status: PrintJobStatus;
  attempts: number;
  claimedAt: string;
  comandaId: string | null;
  comandaItemId: string | null;
  columns: number;
  codepage: number;
  data: string;
};

/** Item de `GET /api/print-jobs` (metadados + payload, sem os bytes). */
export type PrintJobDTO = {
  id: string;
  printerId: string;
  comandaId: string | null;
  comandaItemId: string | null;
  kind: PrintJobKind;
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
  payload: unknown;
};

export type PrinterDTO = {
  id: string;
  name: string;
  address: string;
  transport: PrinterTransport;
  columns: number;
  codepage: number;
  active: boolean;
  printsBill: boolean;
  createdAt: string;
  pendingJobs: number;
  /** Agente (printd) que drena esta fila; null = fila livre. */
  agentId: string | null;
  agentName: string | null;
  baud: number | null;
  boundAt: string | null;
};
