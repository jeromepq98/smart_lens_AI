import { z } from 'zod';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const adminLoginSchema = z.object({
  username: z.string().trim().min(1).max(60),
  password: z.string().min(1).max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12, 'Use at least 12 characters.').max(200),
});

export const usageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
  action: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,60}$/)
    .optional(),
});

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || /^(https:\/\/|\/)/i.test(value), 'Use an https:// or root-relative URL.')
  .optional();

const brandingSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    tagline: z.string().trim().max(160).optional(),
    organization: z.string().trim().max(120).optional(),
    contactEmail: z.union([z.literal(''), z.string().trim().email().max(160)]).optional(),
    contactPhone: z.string().trim().max(40).optional(),
    theme: z
      .object({
        primary: z.string().regex(HEX_COLOR, 'Use a hex color like #0f9d76.').optional(),
        accent: z.string().regex(HEX_COLOR, 'Use a hex color like #0f766e.').optional(),
      })
      .optional(),
    logoUrl: optionalUrl,
    faviconUrl: optionalUrl,
  })
  .partial();

const aiSchema = z
  .object({
    visionModel: z.string().trim().min(1).max(80).optional(),
    textModel: z.string().trim().min(1).max(80).optional(),
    maxOutputTokens: z.number().int().min(100).max(8000).optional(),
    visionTimeoutMs: z.number().int().min(5000).max(120000).optional(),
    chatTimeoutMs: z.number().int().min(5000).max(120000).optional(),
    learningTimeoutMs: z.number().int().min(5000).max(120000).optional(),
    apiKey: z.string().trim().max(400).optional(),
    clearApiKey: z.boolean().optional(),
  })
  .partial();

const limitsSchema = z
  .object({
    dailyScans: z.number().int().min(1).max(1000).optional(),
    scanPerMinute: z.number().int().min(1).max(120).optional(),
    chatPerMinute: z.number().int().min(1).max(240).optional(),
    reanalyzePerMinute: z.number().int().min(1).max(60).optional(),
  })
  .partial();

const uploadSchema = z
  .object({
    maxSizeMb: z.number().int().min(1).max(50).optional(),
    maxDimension: z.number().int().min(256).max(4096).optional(),
    allowedTypes: z
      .array(z.enum(['image/jpeg', 'image/png', 'image/webp']))
      .min(1)
      .max(3)
      .optional(),
  })
  .partial();

const languagesSchema = z
  .object({
    supported: z.array(z.enum(['en', 'fil', 'ceb'])).min(1).max(3).optional(),
    default: z.enum(['en', 'fil', 'ceb']).optional(),
  })
  .partial();

const retentionSchema = z
  .object({
    scanDays: z.number().int().min(1).max(3650).optional(),
    usageLogDays: z.number().int().min(1).max(3650).optional(),
    errorLogDays: z.number().int().min(1).max(3650).optional(),
  })
  .partial();

const featuresSchema = z
  .object({
    learningMode: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    pdfExport: z.boolean().optional(),
  })
  .partial();

const systemSchema = z
  .object({
    maintenanceMode: z.boolean().optional(),
    maintenanceMessage: z.string().trim().max(300).optional(),
    appVersion: z.string().trim().max(20).optional(),
  })
  .partial();

const costSchema = z
  .object({
    visionInputPer1M: z.number().min(0).max(1000).optional(),
    visionOutputPer1M: z.number().min(0).max(1000).optional(),
    textInputPer1M: z.number().min(0).max(1000).optional(),
    textOutputPer1M: z.number().min(0).max(1000).optional(),
    currency: z.string().trim().length(3).optional(),
  })
  .partial();

const privacySchema = z
  .object({
    disclosure: z.string().trim().min(1).max(2000).optional(),
    retentionDays: z.number().int().min(1).max(3650).optional(),
  })
  .partial();

export const adminSettingsSchema = z
  .object({
    branding: brandingSchema.optional(),
    ai: aiSchema.optional(),
    limits: limitsSchema.optional(),
    upload: uploadSchema.optional(),
    languages: languagesSchema.optional(),
    retention: retentionSchema.optional(),
    features: featuresSchema.optional(),
    system: systemSchema.optional(),
    cost: costSchema.optional(),
    privacy: privacySchema.optional(),
  })
  .strict();
