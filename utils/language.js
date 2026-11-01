export const SUPPORTED_LANGUAGES = Object.freeze(['en', 'fil', 'ceb']);

const LANGUAGE_NAMES = Object.freeze({
  en: 'English',
  fil: 'Filipino',
  ceb: 'Cebuano',
});

export function normalizeLanguage(value, fallback = 'en') {
  if (typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value)) return value;
  return fallback;
}

export function languageName(value) {
  return LANGUAGE_NAMES[normalizeLanguage(value)] || LANGUAGE_NAMES.en;
}

export function localizedCategoryName(row, language = 'en') {
  if (!row) return '';
  const normalized = normalizeLanguage(language);
  if (normalized === 'fil') return row.name_fil || row.name_en;
  if (normalized === 'ceb') return row.name_ceb || row.name_en;
  return row.name_en;
}
