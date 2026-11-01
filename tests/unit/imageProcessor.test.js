import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { processImage } from '../../services/imageProcessor.js';

const limits = {
  maxBytes: 5 * 1024 * 1024,
  maxDimension: 1600,
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
};

async function jpegWithExif(width = 300, height = 200) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 120, b: 90 } },
  })
    .withMetadata({ exif: { IFD0: { Copyright: 'SmartLens test', Software: 'fixture' } } })
    .jpeg()
    .toBuffer();
}

describe('image processing', () => {
  it('rejects non-image content even when the filename claims otherwise', async () => {
    await expect(processImage(Buffer.from('not an image at all'), limits)).rejects.toMatchObject({
      statusCode: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
  });

  it('rejects files larger than the configured limit', async () => {
    const buffer = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    await expect(processImage(buffer, { ...limits, maxBytes: 10 })).rejects.toMatchObject({
      statusCode: 413,
    });
  });

  it('strips EXIF metadata and re-encodes JPEG', async () => {
    const input = await jpegWithExif();
    const before = await sharp(input).metadata();
    expect(before.exif).toBeTruthy();

    const output = await processImage(input, limits);
    expect(output.mimeType).toBe('image/jpeg');
    expect(output.extension).toBe('jpg');

    const after = await sharp(output.buffer).metadata();
    expect(after.exif).toBeFalsy();
    expect(after.icc).toBeFalsy();
  });

  it('resizes oversized images without enlarging small ones', async () => {
    const large = await sharp({
      create: { width: 4000, height: 2000, channels: 3, background: '#123456' },
    })
      .jpeg()
      .toBuffer();
    const output = await processImage(large, { ...limits, maxDimension: 500 });
    expect(Math.max(output.width, output.height)).toBe(500);

    const small = await sharp({
      create: { width: 120, height: 80, channels: 3, background: '#123456' },
    })
      .jpeg()
      .toBuffer();
    const smallOutput = await processImage(small, limits);
    expect(smallOutput.width).toBe(120);
  });

  it('accepts PNG and WebP uploads', async () => {
    const png = await sharp({
      create: { width: 50, height: 50, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const webp = await sharp({
      create: { width: 50, height: 50, channels: 3, background: '#abcdef' },
    })
      .webp()
      .toBuffer();

    await expect(processImage(png, limits)).resolves.toMatchObject({ mimeType: 'image/png' });
    await expect(processImage(webp, limits)).resolves.toMatchObject({ mimeType: 'image/webp' });
  });
});
