import * as scanService from '../services/scanService.js';
import { badRequest } from '../utils/errors.js';

export async function createScan(req, res) {
  if (!req.file) {
    throw badRequest('An image file is required. Send it using the "image" field.');
  }

  const { language, source, client_scan_id: idempotencyKey } = req.body;
  const result = await scanService.createScan({
    sessionId: req.anonymousSessionId,
    file: req.file,
    source,
    language,
    idempotencyKey,
    ip: req.ip,
  });

  const payload = await scanService.getScanPayload(result.scanId, req.anonymousSessionId);
  res.status(result.replayed ? 200 : 201).json({ data: { ...payload, replayed: result.replayed } });
}

export async function listScans(req, res) {
  const data = await scanService.listScans({
    sessionId: req.anonymousSessionId,
    ...req.validatedQuery,
  });
  res.json({ data });
}

export async function getScan(req, res) {
  const data = await scanService.getScanPayload(req.validatedParams.id, req.anonymousSessionId);
  res.json({ data });
}

export async function getScanImage(req, res) {
  const { buffer, mimeType } = await scanService.getScanImage({
    scanId: req.validatedParams.id,
    sessionId: req.anonymousSessionId,
  });
  res.set('Cache-Control', 'private, no-store');
  res.type(mimeType).send(buffer);
}

export async function deleteScan(req, res) {
  await scanService.deleteScan({
    scanId: req.validatedParams.id,
    sessionId: req.anonymousSessionId,
  });
  res.status(204).end();
}

export async function reanalyzeScan(req, res) {
  const data = await scanService.reanalyzeScan({
    scanId: req.validatedParams.id,
    sessionId: req.anonymousSessionId,
    language: req.body.language,
    ip: req.ip,
  });
  res.json({ data });
}
