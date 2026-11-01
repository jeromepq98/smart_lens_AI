import sharp from 'sharp';
import { badRequest, payloadTooLarge, unsupportedMedia } from '../utils/errors.js';
import { sha256 } from '../utils/hash.js';

const FORMAT_TO_MIME = Object.freeze({
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

const MIME_TO_EXTENSION = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

const MAX_INPUT_PIXELS = 50_000_000;

export async function processImage(buffer, { maxBytes, maxDimension, allowedTypes }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw badRequest('An image file is required.');
  }
  if (buffer.length > maxBytes) {
    throw payloadTooLarge(`The image exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`);
  }

  let metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw unsupportedMedia('The uploaded file is not a readable image.');
  }

  const mimeType = FORMAT_TO_MIME[metadata.format];
  if (!mimeType || !allowedTypes.includes(mimeType)) {
    throw unsupportedMedia('Only JPEG, PNG, and WebP images are supported.');
  }

  let pipeline = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    });

  if (mimeType === 'image/jpeg') pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
  else if (mimeType === 'image/png') pipeline = pipeline.png({ compressionLevel: 9 });
  else pipeline = pipeline.webp({ quality: 85 });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    mimeType,
    extension: MIME_TO_EXTENSION[mimeType],
    width: info.width,
    height: info.height,
    byteSize: info.size,
    sha256: sha256(data),
  };
}

export default processImage;
