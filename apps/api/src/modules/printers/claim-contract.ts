import { z } from 'zod';

export const claimSchema = z.object({
  printerId: z.uuid(),
  agentId: z.string().min(6).max(64),
  limit: z.number().int().min(1).max(32).optional(),
});
