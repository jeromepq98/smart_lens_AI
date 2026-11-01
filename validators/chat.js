import { z } from 'zod';

export const chatMessageSchema = z.object({
  content: z.string().trim().min(1, 'The message cannot be empty.').max(2000, 'Messages are limited to 2000 characters.'),
  language: z.enum(['en', 'fil', 'ceb']).default('en'),
});

export const regenerateSchema = z.object({
  language: z.enum(['en', 'fil', 'ceb']).optional(),
});
