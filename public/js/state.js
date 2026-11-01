export const STORAGE_KEYS = Object.freeze({
  language: 'smartlens.language',
  theme: 'smartlens.theme',
  configCache: 'smartlens.config-cache',
  categoriesCache: 'smartlens.categories-cache',
  installDismissed: 'smartlens.install-dismissed',
});

export const state = {
  config: null,
  categories: [],
  language: 'en',
  theme: 'system',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pendingCount: 0,
  syncing: false,
  syncError: false,
  updateReady: false,
  installPromptEvent: null,
};

const listeners = new Map();

export function on(event, listener) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(listener);
  return () => listeners.get(event)?.delete(listener);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const listener of [...set]) {
    try {
      listener(payload);
    } catch (error) {
      console.error(`Listener for "${event}" failed`, error);
    }
  }
}

export function adoptConfig(config) {
  if (!config) return;
  state.config = config;
  if (config.limits) state.config.limits = config.limits;
}

export function categoryBySlug(slug) {
  return state.categories.find((category) => category.slug === slug) || null;
}
