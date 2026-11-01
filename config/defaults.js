import config from './env.js';

export const SETTINGS_DEFAULTS = Object.freeze({
  branding: {
    isPublic: true,
    value: {
      title: 'SmartLens AI',
      tagline: 'Scan Anything. Understand Everything. Discover What to Do Next.',
      organization: '',
      contactEmail: '',
      contactPhone: '',
      theme: { primary: '#0f9d76', accent: '#0f766e' },
      logoUrl: '',
      faviconUrl: '',
    },
  },
  ai: {
    isPublic: false,
    value: {
      visionModel: config.gemini.visionModel,
      textModel: config.gemini.textModel,
      maxOutputTokens: 1400,
      visionTimeoutMs: 60000,
      chatTimeoutMs: 30000,
      learningTimeoutMs: 30000,
    },
  },
  limits: {
    isPublic: true,
    value: {
      dailyScans: config.upload.maxDailyScans,
      scanPerMinute: 5,
      chatPerMinute: 12,
      reanalyzePerMinute: 3,
    },
  },
  upload: {
    isPublic: true,
    value: {
      maxSizeMb: config.upload.maxImageSizeMb,
      maxDimension: config.upload.maxDimension,
      allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    },
  },
  languages: {
    isPublic: true,
    value: {
      supported: ['en', 'fil', 'ceb'],
      default: 'en',
    },
  },
  retention: {
    isPublic: false,
    value: {
      scanDays: 30,
      usageLogDays: 180,
      errorLogDays: 90,
    },
  },
  features: {
    isPublic: true,
    value: {
      learningMode: true,
      pushNotifications: false,
      pdfExport: true,
    },
  },
  system: {
    isPublic: true,
    value: {
      maintenanceMode: false,
      maintenanceMessage: 'SmartLens AI is undergoing scheduled maintenance. Please try again shortly.',
      appVersion: config.version,
    },
  },
  cost: {
    isPublic: false,
    value: {
      visionInputPer1M: 0.3,
      visionOutputPer1M: 2.5,
      textInputPer1M: 0.3,
      textOutputPer1M: 2.5,
      currency: 'USD',
    },
  },
  privacy: {
    isPublic: true,
    value: {
      disclosure:
        'Images you submit are sent to Google Gemini for analysis and are not made public. Scan history is stored privately and can be deleted at any time. AI identifications are probabilistic and must not be treated as professional, medical, or safety advice.',
      retentionDays: 30,
    },
  },
});

export const PUBLIC_SETTING_KEYS = Object.freeze(
  Object.entries(SETTINGS_DEFAULTS)
    .filter(([, definition]) => definition.isPublic)
    .map(([key]) => key),
);

export const CATEGORY_SEED = Object.freeze([
  { slug: 'plant', nameEn: 'Plant', nameFil: 'Halaman', nameCeb: 'Tanom', icon: 'bi-flower1', sortOrder: 1 },
  { slug: 'animal', nameEn: 'Animal', nameFil: 'Hayop', nameCeb: 'Mananap', icon: 'bi-paw', sortOrder: 2 },
  { slug: 'food', nameEn: 'Food', nameFil: 'Pagkain', nameCeb: 'Pagkaon', icon: 'bi-egg-fried', sortOrder: 3 },
  { slug: 'electronics', nameEn: 'Electronics', nameFil: 'Elektronika', nameCeb: 'Elektroniks', icon: 'bi-cpu', sortOrder: 4 },
  { slug: 'object', nameEn: 'Object', nameFil: 'Bagay', nameCeb: 'Butang', icon: 'bi-box', sortOrder: 5 },
  { slug: 'insect', nameEn: 'Insect', nameFil: 'Insekto', nameCeb: 'Insekto', icon: 'bi-bug', sortOrder: 6 },
  { slug: 'landmark', nameEn: 'Landmark', nameFil: 'Palatandaan', nameCeb: 'Landmark', icon: 'bi-bank', sortOrder: 7 },
  { slug: 'document', nameEn: 'Document', nameFil: 'Dokumento', nameCeb: 'Dokumento', icon: 'bi-file-earmark-text', sortOrder: 8 },
  { slug: 'other', nameEn: 'Other', nameFil: 'Iba pa', nameCeb: 'Uban pa', icon: 'bi-collection', sortOrder: 9 },
]);

export const SUPPORTED_LANGUAGES = Object.freeze(['en', 'fil', 'ceb']);
