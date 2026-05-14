import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import 'reflect-metadata';

import { buildApp } from './bootstrap';
import { ENV } from './shared/enums';

/**
 * Standalone entry point.
 *
 * Used by `npm run dev` (watch mode) and `npm run prod`
 * (`node build/main`). The same build is what Railway / Render / fly.io
 * / Docker / a plain VPS will run.
 *
 * The Vercel deploy goes through `api/index.ts` instead. Both entry
 * points call the shared `buildApp()` helper so global pipes, body
 * parsers, CORS, and Swagger are identical across environments.
 */
async function main() {
  const app = await buildApp();
  const configService = app.get(ConfigService);
  const logger = app.get(Logger);

  const port = configService.get<number>(ENV.APP_PORT);
  // Bind to 0.0.0.0 so managed hosts (Railway, Render, fly, Docker, etc.)
  // can route external traffic to the container. Defaulting to localhost
  // would silently break in those environments.
  await app.listen(port, '0.0.0.0');

  logger.log(`Image-diff API listening on ${await app.getUrl()}`, 'Bootstrap');
}

main();
