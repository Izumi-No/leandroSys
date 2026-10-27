/** Formatação pt-BR (a API devolve dinheiro como string com 2 casas). */

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function brl(valor: string | number): string {
  const numero = typeof valor === 'number' ? valor : Number(valor);
  if (Number.isNaN(numero)) return '—';
  return MOEDA.format(numero);
}

export function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Minutos desde a abertura — usado para mostrar o tempo de mesa. */
export function minutosDesde(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}

export function plural(n: number, singular: string, plural_: string): string {
  return n === 1 ? singular : plural_;
}
