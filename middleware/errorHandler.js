import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import logger from '../utils/logger.js';
import * as errorLogModel from '../models/errorLog.js';

function zodDetails(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

export function apiNotFound(req, res, next) {
  next(new AppError(`API route not found: ${req.method} ${req.originalUrl}`, { statusCode: 404, code: 'NOT_FOUND' }));
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong. Please try again.';
  let details;

  if (err instanceof AppError) {
    status = err.statusCode;
    code = err.code;
    message = err.expose ? err.message : 'Something went wrong. Please try again.';
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Some fields are invalid.';
    details = zodDetails(err);
  } else if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'The uploaded image is too large.';
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      status = 400;
      code = 'UNEXPECTED_FILE';
      message = 'Unexpected file field. Upload a single image using the "image" field.';
    } else {
      status = 400;
      code = 'UPLOAD_ERROR';
      message = 'The image upload could not be processed.';
    }
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'The request body must contain valid JSON.';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'The request body is too large.';
  } else if (err?.code === 'ER_DUP_ENTRY') {
    status = 409;
    code = 'DUPLICATE_RECORD';
    message = 'This record already exists.';
  } else if (err?.code === 'ER_NO_REFERENCED_ROW_2') {
    status = 400;
    code = 'INVALID_REFERENCE';
    message = 'The request references a record that does not exist.';
  }

  const logPayload = {
    err,
    requestId: req.id,
    status,
    code,
    method: req.method,
    path: req.originalUrl,
  };
  if (status >= 500) {
    logger.error(logPayload, 'request failed');
    errorLogModel.add({
      requestId: req.id,
      level: 'error',
      code,
      message: err?.message || message,
      path: req.originalUrl,
      metadata: { method: req.method, status },
    });
  } else {
    logger.warn(logPayload, 'request rejected');
  }

  const body = { error: { code, message }, requestId: req.id };
  if (details) body.error.details = details;
  if (status >= 500 && !res.app.get('env').startsWith('production') && err?.message) {
    body.error.debug = err.message;
  }

  res.status(status).json(body);
}

export default errorHandler;
