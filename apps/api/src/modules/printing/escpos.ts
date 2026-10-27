import iconv from 'iconv-lite';

/**
 * Codificação ESC/POS para impressoras térmicas.
 *
 * O cupom é renderizado **no backend**: o cliente (Electron) só recebe os bytes
 * em base64 e escreve no socket bluetooth. A tabela de caracteres é a CP850
 * (PC850), selecionada via `ESC t <codepage>` — o índice é configurável por
 * impressora porque clones baratos (XPrinter, Zjiang...) usam índices diferentes.
 */

export type TicketAlign = 'left' | 'center' | 'right';
export type TicketSize = 'normal' | 'big' | 'wide' | 'tall';

export type TicketLine =
  | { t: 'text'; text: string; align?: TicketAlign; bold?: boolean; size?: TicketSize }
  | { t: 'kv'; k: string; v: string; bold?: boolean; size?: TicketSize; align?: TicketAlign }
  | { t: 'rule' }
  | { t: 'feed'; n?: number };

export type TicketDoc = {
  title?: string;
  subtitle?: string;
  lines: TicketLine[];
  cut?: boolean;
};

export type RenderOptions = {
  columns: number;
  codepage: number;
};

const ESC = 0x1b;
const GS = 0x1d;

const ALIGN: Record<TicketAlign, number> = { left: 0, center: 1, right: 2 };
const SIZE: Record<TicketSize, number> = { normal: 0x00, big: 0x11, wide: 0x10, tall: 0x01 };

const chars = (text: string): string[] => Array.from(text);

const truncate = (text: string, max: number): string => {
  if (max <= 0) return '';
  const parts = chars(text);
  return parts.length <= max ? parts.join('') : parts.slice(0, max).join('');
};

/** Largura em células: `big`/`wide` dobram a horizontal. */
const cellWidth = (size: TicketSize): number => (size === 'big' || size === 'wide' ? 2 : 1);

/** Renderiza o documento e devolve os bytes prontos para a impressora. */
export function renderTicket(doc: TicketDoc, options: RenderOptions): Buffer {
  const columns = Math.max(8, options.columns || 32);
  const codepage = Math.max(0, Math.min(255, options.codepage ?? 19));

  const bytes: number[] = [];

  const write = (text: string, maxChars: number): void => {
    for (const byte of iconv.encode(truncate(text, maxChars), 'cp850')) bytes.push(byte);
  };

  const applyStyle = (align: TicketAlign, bold: boolean, size: TicketSize): void => {
    bytes.push(ESC, 0x61, ALIGN[align], ESC, 0x45, bold ? 1 : 0, GS, 0x21, SIZE[size]);
  };

  const resetStyle = (): void => applyStyle('left', false, 'normal');

  const text = (value: string, style: { align?: TicketAlign; bold?: boolean; size?: TicketSize } = {}): void => {
    const align = style.align ?? 'left';
    const bold = style.bold ?? false;
    const size = style.size ?? 'normal';
    applyStyle(align, bold, size);
    write(value, Math.floor(columns / cellWidth(size)));
    resetStyle();
  };

  const kv = (line: { k: string; v: string; bold?: boolean; size?: TicketSize; align?: TicketAlign }): void => {
    const size = line.size ?? 'normal';
    const cell = Math.floor(columns / cellWidth(size));
    const value = truncate(line.v, cell);
    const key = truncate(line.k, Math.max(0, cell - value.length));
    const gap = Math.max(0, cell - key.length - value.length);
    text(`${key}${' '.repeat(gap)}${value}`, { bold: line.bold, size, align: line.align });
  };

  const line = (entry: TicketLine): void => {
    switch (entry.t) {
      case 'text':
        text(entry.text, { align: entry.align, bold: entry.bold, size: entry.size });
        return;
      case 'kv':
        kv(entry);
        return;
      case 'rule':
        text('-'.repeat(columns));
        return;
      case 'feed':
        bytes.push(ESC, 0x64, Math.max(1, Math.min(10, entry.n ?? 1)));
        return;
    }
  };

  // Inicializa e escolhe a tabela de caracteres.
  bytes.push(ESC, 0x40, ESC, 0x74, codepage);

  if (doc.title) text(doc.title, { align: 'center', bold: true, size: 'big' });
  if (doc.subtitle) text(doc.subtitle, { align: 'center' });
  if (doc.title || doc.subtitle) line({ t: 'rule' });

  for (const entry of doc.lines) line(entry);

  bytes.push(ESC, 0x64, 3); // avança 3 linhas antes do corte
  if (doc.cut !== false) bytes.push(GS, 0x56, 0x00); // corte total

  return Buffer.from(bytes);
}

/** Mesma saída de `renderTicket`, em base64 para trafegar em JSON. */
export function renderTicketBase64(doc: TicketDoc, options: RenderOptions): string {
  return renderTicket(doc, options).toString('base64');
}
