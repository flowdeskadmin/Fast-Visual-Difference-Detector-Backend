import { APP_ENV, ENV } from '@/shared/enums';

import { transformToInt } from '../helpers';

export const Configuration = () => ({
  [ENV.APP_NAME]: process.env.APP_NAME || 'image-diff-backend',
  [ENV.APP_ENV]: process.env.APP_ENV || APP_ENV.DEV,
  [ENV.IS_PRD]: process.env.APP_ENV === APP_ENV.PRD,
  [ENV.IS_TEST]: process.env.APP_ENV === APP_ENV.TEST,
  [ENV.IS_STG]: process.env.APP_ENV === APP_ENV.STG,
  [ENV.IS_DEV]: process.env.APP_ENV === APP_ENV.DEV,
  // Railway / Render / Heroku / fly inject the listen port as `PORT`. Honour
  // that when present so the same build runs unchanged on any managed host;
  // locally `APP_PORT` still wins for explicit overrides.
  [ENV.APP_PORT]: transformToInt(process.env.APP_PORT || process.env.PORT || '8000'),

  [ENV.LOGGER_TYPE]: process.env.LOGGER_TYPE || 'console',
  [ENV.LOGGER_MAX_FILES]: process.env.LOGGER_MAX_FILES || '30d',
  [ENV.LOGGER_LEVEL]: process.env.LOGGER_LEVEL || 'info',
  [ENV.LOGGER_DATABASE_URL]: process.env.LOGGER_DATABASE_URL,

  [ENV.BODY_SIZE]: process.env.BODY_SIZE || '60mb',

  [ENV.SWAGGER_TITLE]: process.env.SWAGGER_TITLE || 'Image Diff API',
  [ENV.SWAGGER_DESCRIPTION]:
    process.env.SWAGGER_DESCRIPTION || 'Server-side image diff endpoint backing the React UI.',
  [ENV.SWAGGER_VERSION]: process.env.SWAGGER_VERSION || '0.1',
  [ENV.SWAGGER_FAVICON]: process.env.SWAGGER_FAVICON || '/favicon.ico',
  [ENV.SWAGGER_ENDPOINT]: process.env.SWAGGER_ENDPOINT || '/api-docs',

  // Comma-separated list of allowed origins (Vite dev server by default).
  [ENV.CORS_ORIGIN]: process.env.CORS_ORIGIN || 'http://localhost:5173',

  [ENV.MAX_IMAGE_BYTES]: transformToInt(process.env.MAX_IMAGE_BYTES || `${30 * 1024 * 1024}`),
});
