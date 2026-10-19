import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['ok', 'unavailable']),
  version: z.string(),
  clinicalUseApproved: z.literal(false),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
