import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import config from './config/env.js';
import { logger } from './utils/logger.js';
import { requestContext } from './middleware/requestContext.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { apiNotFound, errorHandler } from './middleware/errorHandler.js';
import healthRouter from './routes/health.js';
import publicRouter from './routes/public.js';
import adminRouter from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

export function createApp() {
  const app = express();

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: {
        ignore: (req) => req.url === '/api/health' || req.url === '/api/ready',
      },
      serializers: {
        req(req) {
          return { id: req.id, method: req.method, url: req.url, remoteAddress: req.remoteAddress };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    }),
  );

  app.use(securityHeaders);
  app.use(compression());
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(cookieParser(config.security.sessionSecret));

  app.use('/api', healthRouter);
  app.use('/api', publicRouter);
  app.use('/api/admin', adminRouter);

  app.get(['/admin', '/admin/'], (req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'));
  });

  app.use(
    express.static(publicDir, {
      index: 'index.html',
      etag: true,
      lastModified: true,
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        const revalidate =
          name === 'sw.js' ||
          name === 'manifest.json' ||
          name.endsWith('.html') ||
          name.endsWith('.js') ||
          name.endsWith('.css');
        res.setHeader('Cache-Control', revalidate ? 'no-cache' : 'public, max-age=86400');
      },
    }),
  );

  app.use('/api', apiNotFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
