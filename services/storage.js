import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import config from '../config/env.js';
import { AppError } from '../utils/errors.js';
import logger from '../utils/logger.js';
import { newId } from '../utils/uuid.js';

const localRoot = path.resolve(config.upload.dir);
let s3Client = null;

function resolveLocalPath(key) {
  const full = path.resolve(localRoot, key);
  if (full !== localRoot && !full.startsWith(localRoot + path.sep)) {
    throw new AppError('Invalid storage key.', { statusCode: 400, code: 'INVALID_STORAGE_KEY' });
  }
  return full;
}

function buildKey(extension) {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return path.posix.join(
    'scans',
    String(now.getUTCFullYear()),
    month,
    `${newId()}.${extension}`,
  );
}

function getS3Client() {
  if (!config.storage.bucket) {
    throw new AppError('S3 storage is selected but STORAGE_BUCKET is not configured.', {
      statusCode: 500,
      code: 'STORAGE_NOT_CONFIGURED',
      expose: false,
    });
  }
  if (!s3Client) {
    const hasExplicitCredentials = config.storage.accessKey && config.storage.secretKey;
    s3Client = new S3Client({
      region: config.storage.region || 'us-east-1',
      endpoint: config.storage.endpoint || undefined,
      forcePathStyle: Boolean(config.storage.endpoint),
      ...(hasExplicitCredentials
        ? {
            credentials: {
              accessKeyId: config.storage.accessKey,
              secretAccessKey: config.storage.secretKey,
            },
          }
        : {}),
    });
  }
  return s3Client;
}

export function storageProvider() {
  return config.storage.provider;
}

export async function saveImage({ buffer, extension, mimeType }) {
  const key = buildKey(extension);

  if (config.storage.provider === 's3') {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: config.storage.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ServerSideEncryption: 'AES256',
      }),
    );
  } else {
    const fullPath = resolveLocalPath(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer, { mode: 0o600 });
  }

  return { provider: config.storage.provider, key };
}

export async function readImage({ provider, key }) {
  if (provider === 's3' || (!provider && config.storage.provider === 's3')) {
    const response = await getS3Client().send(
      new GetObjectCommand({ Bucket: config.storage.bucket, Key: key }),
    );
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  try {
    return await fs.readFile(resolveLocalPath(key));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new AppError('The stored image could not be found.', {
        statusCode: 409,
        code: 'IMAGE_MISSING',
      });
    }
    throw error;
  }
}

export async function deleteImage({ provider, key }) {
  try {
    if (provider === 's3' || (!provider && config.storage.provider === 's3')) {
      await getS3Client().send(new DeleteObjectCommand({ Bucket: config.storage.bucket, Key: key }));
    } else {
      await fs.unlink(resolveLocalPath(key));
    }
  } catch (error) {
    if (error.code === 'ENOENT' || error?.name === 'NoSuchKey') return;
    logger.warn({ err: error.message, key }, 'Failed to delete stored image');
  }
}

export async function isStorageWritable() {
  if (config.storage.provider === 's3') {
    return Boolean(config.storage.bucket && (config.storage.endpoint || config.storage.region));
  }
  try {
    await fs.mkdir(localRoot, { recursive: true });
    await fs.access(localRoot, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function localStorageUsageBytes() {
  if (config.storage.provider !== 'local') return null;

  async function walk(directory) {
    let total = 0;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return 0;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) total += await walk(full);
      else if (entry.isFile()) {
        try {
          total += (await fs.stat(full)).size;
        } catch {
          // file may be removed between readdir and stat
        }
      }
    }
    return total;
  }

  return walk(localRoot);
}
