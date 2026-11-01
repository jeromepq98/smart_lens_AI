import { getScanContext } from './scanService.js';
import { getEffectiveSettings } from './settingsService.js';
import { generateLearningContent } from './geminiLearning.js';
import { recordAiUsage } from './geminiClient.js';
import { hashIp } from '../utils/hash.js';
import { AppError } from '../utils/errors.js';

export async function generateLearning({ scanId, sessionId, level, language, ip }) {
  const settings = await getEffectiveSettings();
  if (!settings.features.learningMode) {
    throw new AppError('Learning mode is currently disabled.', {
      statusCode: 403,
      code: 'FEATURE_DISABLED',
    });
  }

  const { aiResult } = await getScanContext(scanId, sessionId);

  let result;
  try {
    result = await generateLearningContent({ aiResult, level, language, settings });
  } catch (error) {
    await recordAiUsage({
      sessionId,
      scanId,
      kind: 'learning',
      endpoint: '/api/scans/:id/learning',
      model: settings.ai.textModel,
      tokensIn: error.usage?.tokensIn || 0,
      tokensOut: error.usage?.tokensOut || 0,
      status: 'error',
      errorCode: error.code || 'LEARNING_FAILED',
      ipHash: hashIp(ip),
      settings,
    });
    throw error;
  }

  await recordAiUsage({
    sessionId,
    scanId,
    kind: 'learning',
    endpoint: '/api/scans/:id/learning',
    model: result.model,
    tokensIn: result.usage.tokensIn,
    tokensOut: result.usage.tokensOut,
    status: 'success',
    latencyMs: result.latencyMs,
    ipHash: hashIp(ip),
    settings,
  });

  return { level, language, model: result.model, ...result.content };
}
