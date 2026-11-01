import { withTransaction } from '../config/db.js';
import * as scanModel from '../models/scan.js';
import * as scanImageModel from '../models/scanImage.js';
import * as aiResultModel from '../models/aiResult.js';
import * as recommendationModel from '../models/recommendation.js';
import * as conversationModel from '../models/conversation.js';
import * as categoryModel from '../models/category.js';
import * as syncLog from '../models/syncLog.js';
import { getEffectiveSettings } from './settingsService.js';
import { processImage } from './imageProcessor.js';
import * as storage from './storage.js';
import { analyzeImage } from './geminiVision.js';
import { recordAiUsage } from './geminiClient.js';
import { hashIp } from '../utils/hash.js';
import { localizedCategoryName } from '../utils/language.js';
import { sanitizeFilename, truncate } from '../utils/sanitize.js';
import { newId } from '../utils/uuid.js';
import { AppError, conflict, notFound, tooManyRequests } from '../utils/errors.js';
import logger from '../utils/logger.js';

function mapCategory(row, language) {
  if (!row) return null;
  return {
    slug: row.slug,
    name: localizedCategoryName(row, language),
    icon: row.icon,
  };
}

function mapScanSummary(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    source: row.source,
    language: row.language,
    status: row.status,
    hasImage: Boolean(row.has_image),
    category: row.category_slug ? mapCategory(row, row.language) : null,
    mainIdentification: row.main_identification || null,
    scientificName: row.scientific_name || null,
    confidence: row.confidence || null,
    description: row.description ? truncate(row.description, 400) : null,
    resultVersion: row.result_version ? Number(row.result_version) : null,
  };
}

async function persistAnalysis({ scanId, sessionId, analysis, language }) {
  const category =
    (await categoryModel.findBySlug(analysis.categorySlug)) ||
    (await categoryModel.findBySlug('other'));

  return withTransaction(async (connection) => {
    const aiRow = await aiResultModel.insertVersion(connection, {
      scanId,
      ...analysis.data,
      locale: language,
      model: analysis.model,
      promptVersion: analysis.promptVersion,
      tokensIn: analysis.usage.tokensIn,
      tokensOut: analysis.usage.tokensOut,
      latencyMs: analysis.latencyMs,
    });

    await recommendationModel.insertMany(connection, {
      scanId,
      aiResultId: aiRow.id,
      locale: language,
      items: analysis.data.recommendations,
    });

    const conversation = await conversationModel.ensure(connection, scanId, sessionId);
    await scanModel.markCompleted(connection, scanId, category?.id ?? null);

    return { aiRow, conversation };
  });
}

async function safeSyncLog(entry) {
  try {
    await syncLog.add(entry);
  } catch (error) {
    logger.debug({ err: error.message }, 'Failed to write sync log');
  }
}

export async function createScan({ sessionId, file, source, language, idempotencyKey, ip }) {
  const settings = await getEffectiveSettings();

  const usedToday = await scanModel.countTodayForSession(sessionId);
  if (usedToday >= settings.limits.dailyScans) {
    throw new AppError(
      `Daily scan limit reached (${settings.limits.dailyScans} scans). Please try again tomorrow.`,
      {
        statusCode: 429,
        code: 'DAILY_LIMIT_REACHED',
        details: { limit: settings.limits.dailyScans, used: usedToday },
      },
    );
  }

  const existing = await scanModel.findByIdempotency(sessionId, idempotencyKey);
  if (existing) {
    await safeSyncLog({
      sessionId,
      scanId: existing.id,
      clientScanId: idempotencyKey,
      action: 'duplicate',
      status: existing.status,
    });
    return { scanId: existing.id, replayed: true };
  }

  const image = await processImage(file.buffer, {
    maxBytes: settings.upload.maxSizeMb * 1024 * 1024,
    maxDimension: settings.upload.maxDimension,
    allowedTypes: settings.upload.allowedTypes,
  });

  const scanId = newId();
  const expiresAt = new Date(Date.now() + settings.retention.scanDays * 24 * 60 * 60 * 1000);
  let usage = { tokensIn: 0, tokensOut: 0 };
  let model = settings.ai.visionModel;
  let stored = null;

  try {
    await scanModel.create({
      id: scanId,
      sessionId,
      idempotencyKey,
      source,
      language,
      expiresAt,
    });

    stored = await storage.saveImage({
      buffer: image.buffer,
      extension: image.extension,
      mimeType: image.mimeType,
    });

    await scanImageModel.create(null, {
      scanId,
      storageProvider: stored.provider,
      storageKey: stored.key,
      mimeType: image.mimeType,
      originalFilename: sanitizeFilename(file.originalname),
      width: image.width,
      height: image.height,
      byteSize: image.byteSize,
      sha256: image.sha256,
    });

    await scanModel.markImageStored(scanId);
    await scanModel.markProcessing(scanId);

    const analysis = await analyzeImage({
      buffer: image.buffer,
      mimeType: image.mimeType,
      language,
      settings,
    });
    usage = analysis.usage;
    model = analysis.model;

    await persistAnalysis({ scanId, sessionId, analysis, language });

    await recordAiUsage({
      sessionId,
      scanId,
      kind: 'vision',
      endpoint: '/api/scans',
      model,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      status: 'success',
      latencyMs: analysis.latencyMs,
      ipHash: hashIp(ip),
      settings,
    });

    await safeSyncLog({
      sessionId,
      scanId,
      clientScanId: idempotencyKey,
      action: 'sync',
      status: 'completed',
    });

    return { scanId, replayed: false };
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      const duplicate = await scanModel.findByIdempotency(sessionId, idempotencyKey);
      if (duplicate) {
        return { scanId: duplicate.id, replayed: true };
      }
    }

    await scanModel.markFailed(scanId, error.code || 'SCAN_FAILED').catch(() => {});

    await recordAiUsage({
      sessionId,
      scanId,
      kind: 'vision',
      endpoint: '/api/scans',
      model,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      status: 'error',
      errorCode: error.code || 'SCAN_FAILED',
      latencyMs: null,
      ipHash: hashIp(ip),
      settings,
    });

    await safeSyncLog({
      sessionId,
      scanId,
      clientScanId: idempotencyKey,
      action: 'error',
      status: error.code || 'SCAN_FAILED',
      detail: error.message,
    });

    error.details = { ...(error.details || {}), scanId };
    throw error;
  }
}

export async function getScanContext(scanId, sessionId) {
  const scan = await scanModel.findByIdForSession(scanId, sessionId);
  if (!scan) throw notFound('Scan not found.');

  const aiRow = await aiResultModel.findCurrentByScanId(scanId);
  if (!aiRow) {
    throw conflict('This scan has no analysis result yet. Analyze the image first.');
  }

  const aiResult = aiResultModel.mapAiResult(aiRow);
  const recommendationRows = await recommendationModel.listByAiResultId(aiResult.id);
  const recommendations = recommendationRows.map(recommendationModel.mapRecommendation);

  return { scan, aiResult, recommendations };
}

export async function getScanPayload(scanId, sessionId) {
  const scan = await scanModel.findByIdForSession(scanId, sessionId);
  if (!scan) throw notFound('Scan not found.');

  const aiRow = await aiResultModel.findCurrentByScanId(scanId);
  const aiResult = aiResultModel.mapAiResult(aiRow);
  const recommendationRows = aiResult
    ? await recommendationModel.listByAiResultId(aiResult.id)
    : [];
  const conversation = await conversationModel.findByScanId(scanId);
  const category = scan.category_id ? await categoryModel.findById(scan.category_id) : null;

  return {
    id: scan.id,
    createdAt: scan.created_at,
    updatedAt: scan.updated_at,
    source: scan.source,
    language: scan.language,
    status: scan.status,
    hasImage: Boolean(scan.has_image),
    errorCode: scan.error_code || null,
    category: mapCategory(category, scan.language),
    result: aiResult,
    recommendations: recommendationRows.map(recommendationModel.mapRecommendation),
    conversation: conversation ? { id: conversation.id } : null,
  };
}

export async function listScans({ sessionId, limit, before, category, q, from, to }) {
  const rows = await scanModel.listForSession(sessionId, {
    limit,
    before,
    category,
    q,
    from,
    to,
  });
  const nextCursor =
    rows.length === limit
      ? new Date(rows[rows.length - 1].created_at).toISOString()
      : null;
  return { items: rows.map(mapScanSummary), nextCursor };
}

export async function getScanImage({ scanId, sessionId }) {
  const scan = await scanModel.findByIdForSession(scanId, sessionId);
  if (!scan) throw notFound('Scan not found.');

  const image = await scanImageModel.findByScanId(scanId);
  if (!image) throw conflict('This scan has no stored image.');

  const buffer = await storage.readImage({
    provider: image.storage_provider,
    key: image.storage_key,
  });
  return { buffer, mimeType: image.mime_type };
}

export async function deleteScan({ scanId, sessionId }) {
  const scan = await scanModel.findByIdForSession(scanId, sessionId);
  if (!scan) throw notFound('Scan not found.');

  const image = await scanImageModel.findByScanId(scanId);
  await scanModel.removeById(scanId);
  if (image) {
    await storage.deleteImage({ provider: image.storage_provider, key: image.storage_key });
  }
}

export async function reanalyzeScan({ scanId, sessionId, language, ip }) {
  const scan = await scanModel.findByIdForSession(scanId, sessionId);
  if (!scan) throw notFound('Scan not found.');

  const image = await scanImageModel.findByScanId(scanId);
  if (!image) {
    throw conflict('This scan has no stored image. Start a new scan instead.');
  }

  const settings = await getEffectiveSettings();
  const locale = language || scan.language;
  const buffer = await storage.readImage({
    provider: image.storage_provider,
    key: image.storage_key,
  });

  let usage = { tokensIn: 0, tokensOut: 0 };
  let model = settings.ai.visionModel;

  try {
    const analysis = await analyzeImage({
      buffer,
      mimeType: image.mime_type,
      language: locale,
      settings,
    });
    usage = analysis.usage;
    model = analysis.model;

    await persistAnalysis({ scanId, sessionId, analysis, language: locale });

    await recordAiUsage({
      sessionId,
      scanId,
      kind: 'vision',
      endpoint: '/api/scans/:id/reanalyze',
      model,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      status: 'success',
      latencyMs: analysis.latencyMs,
      ipHash: hashIp(ip),
      settings,
    });

    return getScanPayload(scanId, sessionId);
  } catch (error) {
    const existingResult = await aiResultModel.findCurrentByScanId(scanId).catch(() => null);
    if (!existingResult) {
      await scanModel.markFailed(scanId, error.code || 'REANALYZE_FAILED').catch(() => {});
    }

    await recordAiUsage({
      sessionId,
      scanId,
      kind: 'vision',
      endpoint: '/api/scans/:id/reanalyze',
      model,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      status: 'error',
      errorCode: error.code || 'REANALYZE_FAILED',
      ipHash: hashIp(ip),
      settings,
    });

    throw error;
  }
}
