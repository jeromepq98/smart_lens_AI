import crypto from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

export default requestContext;
