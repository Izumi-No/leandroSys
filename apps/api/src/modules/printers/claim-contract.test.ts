import { describe, expect, it } from 'vitest';
import { claimSchema } from './claim-contract';

const payloadDoDaemon = {
  printerId: '550e8400-e29b-41d4-a716-446655440000',
  agentId: 'agent-local-123',
  limit: 8,
};

describe('contrato do claim do daemon de impressão', () => {
  it('aceita o payload enviado pelo cliente Go', () => {
    expect(claimSchema.safeParse(payloadDoDaemon)).toEqual({
      success: true,
      data: payloadDoDaemon,
    });
  });

  it('aceita o limite padrão omitido', () => {
    const { limit: _limit, ...payload } = payloadDoDaemon;
    expect(claimSchema.safeParse(payload).success).toBe(true);
  });

  it('rejeita impressora inválida, agente ausente e limites fora do contrato', () => {
    expect(claimSchema.safeParse({ ...payloadDoDaemon, printerId: 'invalid' }).success).toBe(false);
    expect(claimSchema.safeParse({ printerId: payloadDoDaemon.printerId, limit: 8 }).success).toBe(false);
    expect(claimSchema.safeParse({ ...payloadDoDaemon, limit: 0 }).success).toBe(false);
    expect(claimSchema.safeParse({ ...payloadDoDaemon, limit: 33 }).success).toBe(false);
  });
});
