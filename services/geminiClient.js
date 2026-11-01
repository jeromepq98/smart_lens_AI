import { getAiKey, getEffectiveSettings } from './settingsService.js';
import { estimateCost } from './costEstimator.js';
import * as usageLog from '../models/usageLog.js';
import { aiUnavailable, AppError } from '../utils/errors.js';
import logger from '../utils/logger.js';

export const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const SCHEMA_KEY_ALLOWLIST = new Set([
  'type',
  'format',
  'title',
  'description',
  'nullable',
  'enum',
  'items',
  'properties',
  'required',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'propertyOrdering',
]);

// Gemini's responseSchema accepts an OpenAPI subset; unsupported keywords such as
// additionalProperties cause a 400 INVALID_ARGUMENT, so unknown keys are dropped.
export function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const output = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!SCHEMA_KEY_ALLOWLIST.has(key)) continue;
    if (key === 'properties') {
      output.properties = Object.fromEntries(
        Object.entries(value || {}).map(([name, child]) => [name, toGeminiSchema(child)]),
      );
    } else if (key === 'items') {
      output.items = toGeminiSchema(value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

export function normalizeGeminiModel(model) {
  return String(model || '').trim().replace(/^models\//i, '');
}

// Gemini 2.5 Flash/Lite count thinking tokens against maxOutputTokens; disabling
// thinking keeps the JSON response within the configured budget. Pro models reject
// a zero budget, so the flag is only sent for models that support it.
export function thinkingConfigFor(model) {
  if (/^gemini-2\.5-flash/i.test(normalizeGeminiModel(model))) {
    return { thinkingConfig: { thinkingBudget: 0 } };
  }
  return {};
}

function errorText(error) {
  return [
    error?.status,
    error?.code,
    error?.message,
    error?.details,
    error?.body?.error?.status,
    error?.body?.error?.message,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function mapGeminiError(error) {
  if (error instanceof AppError) return error;

  if (
    error?.name === 'TimeoutError' ||
    error?.name === 'AbortError' ||
    error?.code === 'ETIMEDOUT'
  ) {
    return new AppError('The AI service took too long to respond. Please try again.', {
      statusCode: 504,
      code: 'AI_TIMEOUT',
      cause: error,
    });
  }

  const status = Number(error?.status || 0);
  const text = errorText(error);

  if (
    status === 401 ||
    status === 403 ||
    /api key not valid|api_key_invalid|missing a valid api key|permission denied/.test(text)
  ) {
    return new AppError(
      'The AI service rejected the configured Gemini API key. An administrator must check the key and that the Generative Language API is enabled for its project.',
      {
        statusCode: 503,
        code: 'AI_AUTH_ERROR',
        cause: error,
      },
    );
  }

  if (status === 429 || /resource_exhausted|quota/.test(text)) {
    logger.warn({ status, detail: error?.message || error?.body?.error?.message }, 'Gemini request rejected with 429');
    if (/no credits|credit_balance|insufficient_quota|billing (is )?disabled/.test(text)) {
      return new AppError(
        'The Gemini API account has no credits remaining. An administrator must review billing before scans can be analyzed.',
        {
          statusCode: 503,
          code: 'AI_QUOTA_EXHAUSTED',
          cause: error,
        },
      );
    }
    return new AppError(
      'The Gemini API usage quota has been reached. Please try again later or ask an administrator to review the API plan.',
      {
        statusCode: 503,
        code: 'AI_QUOTA_EXHAUSTED',
        cause: error,
      },
    );
  }

  if (status === 404) {
    return new AppError(
      'The configured Gemini model is not available. An administrator must check the model name in AI settings.',
      {
        statusCode: 503,
        code: 'AI_UNAVAILABLE',
        cause: error,
      },
    );
  }

  if (status === 400) {
    logger.warn({ status, detail: error?.message || error?.body?.error?.message }, 'Gemini rejected the request');
    return new AppError('The AI request could not be completed.', {
      statusCode: 502,
      code: 'AI_ERROR',
      cause: error,
    });
  }

  if (status >= 500) {
    return new AppError('The AI service is temporarily unavailable.', {
      statusCode: 503,
      code: 'AI_UNAVAILABLE',
      cause: error,
    });
  }

  if (error?.name === 'TypeError' || error?.code === 'ECONNRESET' || error?.code === 'ENOTFOUND') {
    return new AppError('The AI service could not be reached. Please try again.', {
      statusCode: 502,
      code: 'AI_ERROR',
      cause: error,
    });
  }

  return new AppError('The AI request could not be completed.', {
    statusCode: 502,
    code: 'AI_ERROR',
    cause: error,
  });
}

async function readJson(response) {
  const raw = await response.text();
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { parseFailure: raw.slice(0, 200) };
  }
}

export async function generateGeminiContent({ model, payload, timeoutMs, apiKey }) {
  const key = apiKey || (await getAiKey());
  if (!key) {
    throw aiUnavailable(
      'AI analysis is not configured yet. An administrator must add a Gemini API key.',
    );
  }

  const modelName = normalizeGeminiModel(model);
  const url = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(modelName)}:generateContent`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw mapGeminiError(error);
  }

  const body = await readJson(response);

  if (!response.ok) {
    throw mapGeminiError({
      status: response.status,
      message: body?.error?.message,
      code: body?.error?.status,
      body,
    });
  }

  if (!body || body.parseFailure) {
    throw new AppError('The AI returned an unreadable response.', {
      statusCode: 502,
      code: 'AI_INVALID_RESPONSE',
    });
  }

  return body;
}

const BLOCKED_FINISH_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION', 'SPII']);

export function readCandidate(payload) {
  if (payload?.promptFeedback?.blockReason) {
    throw new AppError('The AI declined to analyze this content.', {
      statusCode: 422,
      code: 'AI_REFUSED',
    });
  }

  const candidate = payload?.candidates?.[0];
  if (candidate?.finishReason && BLOCKED_FINISH_REASONS.has(candidate.finishReason)) {
    throw new AppError('The AI declined to analyze this content.', {
      statusCode: 422,
      code: 'AI_REFUSED',
    });
  }

  const text = (candidate?.content?.parts || [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  return { candidate, text, finishReason: candidate?.finishReason || null };
}

export function usageFrom(payload) {
  const usage = payload?.usageMetadata || {};
  return {
    tokensIn: Number(usage.promptTokenCount || 0),
    tokensOut: Number(usage.candidatesTokenCount || 0),
  };
}

export async function recordAiUsage({
  sessionId,
  scanId,
  kind,
  endpoint,
  model,
  tokensIn,
  tokensOut,
  status,
  errorCode,
  latencyMs,
  ipHash,
  settings,
}) {
  try {
    const effective = settings || (await getEffectiveSettings());
    const estimatedCostUsd = estimateCost(kind, { tokensIn, tokensOut }, effective);
    await usageLog.add({
      sessionId,
      scanId,
      kind,
      endpoint,
      model,
      tokensIn,
      tokensOut,
      estimatedCostUsd,
      status,
      errorCode,
      latencyMs,
      ipHash,
    });
  } catch (error) {
    logger.warn({ err: error.message }, 'Failed to write usage log');
  }
}

export function attachUsage(error, usage) {
  if (usage) error.usage = usage;
  return error;
}
