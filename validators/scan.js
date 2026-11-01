import { z } from 'zod';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const scanIdParamsSchema = z.object({
  id: z.string().regex(UUID, 'Invalid scan id.'),
});

export const scanIdAliasParamsSchema = z.object({
  scanId: z.string().regex(UUID, 'Invalid scan id.'),
});

export const createScanSchema = z.object({
  language: z.enum(['en', 'fil', 'ceb']).default('en'),
  source: z.enum(['camera', 'upload']).default('upload'),
  client_scan_id: z.string().regex(UUID, 'client_scan_id must be a UUID.'),
});

export const listScansQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.coerce.date().optional(),
  category: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,39}$/, 'Invalid category.')
    .optional(),
  q: z.string().trim().min(1).max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const reanalyzeSchema = z.object({
  language: z.enum(['en', 'fil', 'ceb']).optional(),
});

export const learningSchema = z.object({
  level: z.enum(['beginner', 'advanced']).default('beginner'),
  language: z.enum(['en', 'fil', 'ceb']).default('en'),
});
