import path from 'node:path';

export function sanitizeFilename(value) {
  if (!value) return null;
  const base = path
    .basename(String(value))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\w.\- ()[\]]/g, '_')
    .slice(0, 200);
  return base || null;
}

export function truncate(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

export function stripControlCharacters(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}
