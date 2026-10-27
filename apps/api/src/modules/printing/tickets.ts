import { round2 } from '../../lib/money';
import type { TicketDoc, TicketLine } from './escpos';

export type TicketItem = {
  quantity: number;
  name: string;
  note?: string | null;
  aditionals?: string[];
  total?: number;
};

export type TicketComanda = {
  number: number;
  tableNumber: number;
  waiter?: string | null;
  openedAt?: Date | null;
};

const brl = (value: number): string => `R$ ${round2(value).toFixed(2)}`;

const dateTime = (value?: Date | null): string => {
  const date = value ?? new Date();
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const itemLines = (item: TicketItem, showTotal: boolean): TicketLine[] => {
  const lines: TicketLine[] = [
    { t: 'text', text: `${item.quantity}x ${item.name}`, bold: true },
  ];
  for (const aditional of item.aditionals ?? []) {
    lines.push({ t: 'text', text: `   + ${aditional}` });
  }
  if (item.note) lines.push({ t: 'text', text: `   ! ${item.note}` });
  if (showTotal && item.total !== undefined) {
    lines.push({ t: 'kv', k: '', v: brl(item.total) });
  }
  return lines;
};

/** Cupom de produção (cozinha/bar): os itens de uma vez, agrupados por impressora. */
export function itemsTicket(printerName: string, comanda: TicketComanda, items: TicketItem[]): TicketDoc {
  const lines: TicketLine[] = [];
  items.forEach((item, index) => {
    if (index > 0) lines.push({ t: 'feed', n: 1 });
    lines.push(...itemLines(item, false));
  });

  lines.push({ t: 'rule' });
  lines.push({ t: 'kv', k: 'Comanda', v: `#${comanda.number}` });
  lines.push({ t: 'kv', k: 'Mesa', v: String(comanda.tableNumber) });
  if (comanda.waiter) lines.push({ t: 'kv', k: 'Atendente', v: comanda.waiter });
  lines.push({ t: 'kv', k: 'Emitido', v: dateTime() });

  return {
    title: printerName,
    subtitle: `Mesa ${comanda.tableNumber} - Comanda #${comanda.number}`,
    lines,
    cut: true,
  };
}

/** Conta da comanda, com totais e forma de pagamento. */
export function billTicket(
  comanda: TicketComanda,
  items: TicketItem[],
  total: number,
  paymentMethod?: string | null,
): TicketDoc {
  const lines: TicketLine[] = [];

  lines.push({ t: 'kv', k: 'Mesa', v: String(comanda.tableNumber) });
  lines.push({ t: 'kv', k: 'Comanda', v: `#${comanda.number}` });
  if (comanda.waiter) lines.push({ t: 'kv', k: 'Atendente', v: comanda.waiter });
  if (comanda.openedAt) lines.push({ t: 'kv', k: 'Aberta em', v: dateTime(comanda.openedAt) });
  lines.push({ t: 'rule' });

  items.forEach((item, index) => {
    if (index > 0) lines.push({ t: 'feed', n: 1 });
    lines.push(...itemLines(item, true));
  });

  lines.push({ t: 'rule' });
  lines.push({ t: 'kv', k: 'TOTAL', v: brl(total), bold: true, size: 'big' });
  if (paymentMethod) lines.push({ t: 'kv', k: 'Pagamento', v: paymentMethod });
  lines.push({ t: 'kv', k: 'Emitido', v: dateTime() });

  return { title: 'CONTA', subtitle: `Comanda #${comanda.number}`, lines, cut: true };
}

/** Cupom de teste do cadastro de impressora. */
export function testTicket(printerName: string, columns: number): TicketDoc {
  return {
    title: 'TESTE',
    subtitle: printerName,
    lines: [
      { t: 'text', text: 'Impressao OK' },
      { t: 'text', text: 'Acentuacao: aaaaeeiooouuc' },
      { t: 'text', text: 'Acentuacao: AAAAEEIOOOUUC' },
      { t: 'rule' },
      { t: 'kv', k: 'Colunas', v: String(columns) },
      { t: 'kv', k: 'Direita', v: 'R$ 99,90' },
      { t: 'text', text: 'Centralizado', align: 'center' },
      { t: 'text', text: 'Negrito', align: 'center', bold: true },
      { t: 'text', text: 'Grande', size: 'big' },
      { t: 'feed', n: 2 },
    ],
    cut: true,
  };
}
