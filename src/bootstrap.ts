import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { type ExpressAdapter } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';

import { ENV } from './shared/enums';
import { AllExceptionFilter } from './shared/filters';
import { setupSwagger } from './swagger';
import { WebModule } from './web/web.module';

/**
 * Shared NestJS app construction.
 *
 * Both entry points use this:
 *
 *   - `src/main.ts`        — standard long-running Node process. Used by
 *                            `npm run dev`, `npm run prod`, Railway,
 *                            Render, Docker, anything else that accepts a
 *                            normal server.
 *   - `api/index.ts`       — Vercel serverless function. Constructs an
 *                            Express instance up-front and passes it via
 *                            an `ExpressAdapter` so the function can
 *                            forward `(req, res)` straight to Express.
 *
 * Keeping the configuration in one place avoids subtle drift between
 * deployment targets — same CORS rules, same body-parser limits, same
 * global pipe and filter, same Swagger UI.
 *
 * Cold-start note: Swagger adds roughly 100 ms to a Vercel cold boot.
 * That's a small price for having the live Swagger UI available against
 * the deployed API, which is useful for QA / sharing.
 */
export async function buildApp(adapter?: ExpressAdapter): Promise<INestApplication> {
  const app = adapter
    ? await NestFactory.create(WebModule, adapter, { bufferLogs: false })
    : await NestFactory.create(WebModule, { bufferLogs: false });

  const configService = app.get(ConfigService);
  const logger = app.get(Logger);

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  // Body size has to be big enough for two raw screenshots in a multipart
  // upload. Default 100kb express limit would reject anything but tiny
  // PNGs. Note: on Vercel Hobby, the platform-level cap is 4.5 MB and
  // overrides this number, so larger pairs fail at the edge before
  // reaching the function.
  const bodySize = configService.get<string>(ENV.BODY_SIZE) || '60mb';
  app.use(json({ limit: bodySize }));
  app.use(urlencoded({ limit: bodySize, extended: true }));

  app.useGlobalFilters(new AllExceptionFilter(configService, logger));

  // CORS: explicit allow list plus a permanent allowance for any
  // `*.vercel.app` host so frontend preview deploys "just work" without
  // a redeploy of the backend per PR.
  const originList = (configService.get<string>(ENV.CORS_ORIGIN) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      try {
        const host = new URL(origin).hostname;
        if (host.endsWith('.vercel.app') || originList.includes(origin)) {
          return callback(null, true);
        }
      } catch {
        // Fall through to deny.
      }
      callback(new Error(`Not allowed by CORS (${origin})`));
    },
  });

  // Mount Swagger UI at the configured path (defaults to `/api-docs`).
  // Has to come after `setGlobalPrefix` so the document picks up the
  // /api prefix on each operation.
  setupSwagger(app);

  return app;
}
