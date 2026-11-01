import { getPublicConfig } from '../services/settingsService.js';

export async function getConfig(req, res) {
  res.json({ data: await getPublicConfig() });
}
