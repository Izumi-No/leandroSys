import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { parseTicketDoc, renderTicketBase64, type TicketDoc } from './escpos';

const doc: TicketDoc = {
  title: 'Cozinha',
  subtitle: 'Mesa 1 - Comanda #9',
  lines: [
    { t: 'text', bold: true, text: '1x Café Expresso' },
    { t: 'rule' },
    { k: 'Comanda', t: 'kv', v: '#9' },
  ],
  cut: true,
};

const opcoes = { columns: 32, codepage: 19 };

describe('parseTicketDoc', () => {
  it('faz o parse de um payload serializado (string JSON)', () => {
    const parsed = parseTicketDoc(JSON.stringify(doc));

    expect(parsed.title).toBe('Cozinha');
    expect(parsed.lines).toHaveLength(3);
    expect(parsed.lines[0]).toEqual({ t: 'text', bold: true, text: '1x Café Expresso' });
  });

  it('devolve inalterado um payload que já é objeto', () => {
    const parsed = parseTicketDoc(doc);

    expect(parsed).toBe(doc);
    expect(parsed.lines).toHaveLength(3);
  });

  it('rejeita payload sem lines[]', () => {
    expect(() => parseTicketDoc('{"title":"Cozinha"}')).toThrow(/lines/);
    expect(() => parseTicketDoc({ title: 'Cozinha' })).toThrow(/lines/);
    expect(() => parseTicketDoc(null)).toThrow(/lines/);
    expect(() => parseTicketDoc(undefined)).toThrow(/lines/);
    expect(() => parseTicketDoc(42)).toThrow(/lines/);
  });

  it('rejeita lines que não é lista', () => {
    expect(() => parseTicketDoc('{"lines":"nada"}')).toThrow(/lines/);
    expect(() => parseTicketDoc({ lines: { t: 'text' } })).toThrow(/lines/);
  });

  it('propaga erro de JSON malformado', () => {
    expect(() => parseTicketDoc('{não é json')).toThrow();
  });
});

describe('regressão do claim: payload string x render', () => {
  // Antes do fix o payload vinha como string do pg/json e era passado direto
  // ao render, que estourava "doc.lines is not iterable" — derrubando o claim
  // DEPOIS da transação e deixando o job preso em PRINTING.
  it('renderiza um payload vindo como string sem lançar', () => {
    const base64 = renderTicketBase64(parseTicketDoc(JSON.stringify(doc)), opcoes);

    expect(base64).toBeTypeOf('string');
    expect(Buffer.from(base64, 'base64').length).toBeGreaterThan(0);
  });

  it('renderiza igual para string e para objeto equivalentes', () => {
    const daString = renderTicketBase64(parseTicketDoc(JSON.stringify(doc)), opcoes);
    const doObjeto = renderTicketBase64(parseTicketDoc(doc), opcoes);

    expect(daString).toBe(doObjeto);
  });

  it('o caminho antigo (string direto no render) de fato falhava', () => {
    expect(() => renderTicketBase64(JSON.stringify(doc) as unknown as TicketDoc, opcoes)).toThrow(
      /lines/,
    );
  });

  it('os bytes batem com o cupom esperado (a acentuação não quebra)', () => {
    const bytes = Buffer.from(renderTicketBase64(parseTicketDoc(JSON.stringify(doc)), opcoes), 'base64');

    // ESC @ = inicializa; ESC t = escolhe codepage; GS V = corta
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
    expect(bytes.includes(0x1d)).toBe(true);

    // o conteúdo sai em cp850 — decodifica de volta para conferir o texto
    const texto = iconv.decode(bytes, 'cp850');
    expect(texto).toContain('Cozinha');
    expect(texto).toContain('Café Expresso');
    expect(texto).toContain('Mesa 1 - Comanda #9');
  });
});
