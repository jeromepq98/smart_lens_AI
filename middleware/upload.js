import multer from 'multer';
import config from '../config/env.js';
import { AppError } from '../utils/errors.js';

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: config.upload.maxImageSizeBytes,
    files: 1,
    fields: 10,
    fieldSize: 4096,
  },
  fileFilter(req, file, callback) {
    if (!config.upload.allowedMimeTypes.includes(file.mimetype)) {
      callback(
        new AppError('Only JPEG, PNG, and WebP images are supported.', {
          statusCode: 415,
          code: 'UNSUPPORTED_MEDIA_TYPE',
        }),
      );
      return;
    }
    callback(null, true);
  },
});

export const uploadImage = upload.single('image');
