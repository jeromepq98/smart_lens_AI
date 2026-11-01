import { getEffectiveSettings } from '../services/settingsService.js';
import { AppError } from '../utils/errors.js';

export async function maintenanceMode(req, res, next) {
  try {
    const settings = await getEffectiveSettings();
    if (settings.system?.maintenanceMode) {
      return next(
        new AppError(
          settings.system?.maintenanceMessage ||
            'SmartLens AI is undergoing maintenance. Please try again shortly.',
          { statusCode: 503, code: 'MAINTENANCE' },
        ),
      );
    }
    next();
  } catch (error) {
    next(error);
  }
}

export default maintenanceMode;
