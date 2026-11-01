export class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR', details, expose = true, cause } = {}) {
    super(message, { cause });
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = expose;
    this.isOperational = true;
  }
}

export const badRequest = (message, details) =>
  new AppError(message, { statusCode: 400, code: 'BAD_REQUEST', details });

export const validationError = (message, details) =>
  new AppError(message, { statusCode: 400, code: 'VALIDATION_ERROR', details });

export const unauthorized = (message = 'Authentication required.') =>
  new AppError(message, { statusCode: 401, code: 'UNAUTHORIZED' });

export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError(message, { statusCode: 403, code: 'FORBIDDEN' });

export const notFound = (message = 'Resource not found.') =>
  new AppError(message, { statusCode: 404, code: 'NOT_FOUND' });

export const conflict = (message, details) =>
  new AppError(message, { statusCode: 409, code: 'CONFLICT', details });

export const payloadTooLarge = (message = 'The uploaded file is too large.') =>
  new AppError(message, { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' });

export const unsupportedMedia = (message = 'Unsupported image format.') =>
  new AppError(message, { statusCode: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });

export const tooManyRequests = (message = 'Too many requests. Please try again later.') =>
  new AppError(message, { statusCode: 429, code: 'RATE_LIMITED' });

export const aiUnavailable = (message = 'AI analysis is temporarily unavailable.') =>
  new AppError(message, { statusCode: 503, code: 'AI_UNAVAILABLE' });

export const notImplemented = (message) =>
  new AppError(message, { statusCode: 501, code: 'NOT_IMPLEMENTED' });

export const isAppError = (error) => error instanceof AppError;
