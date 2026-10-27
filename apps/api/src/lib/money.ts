type MoneyLike = string | number | { toString(): string } | null | undefined;

/** Converte um Decimal do banco (string/objeto) em número finito. */
export function toNumber(value: MoneyLike): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Valor monetário pronto para resposta da API (número com 2 casas). */
export function money(value: MoneyLike): number {
  return round2(toNumber(value));
}
