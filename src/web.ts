import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import 'reflect-metadata';

import { ENV } from './shared/enums';
import { AllExceptionFilter } from './shared/filters';
import { setupSwagger } from './swagger';
import { WebModule } from './web/web.module';

async function bootstrap() {
  const web = await NestFactory.create(WebModule, {
    bufferLogs: false,
  });

  const configService = web.get(ConfigService);
  const logger = web.get(Logger);

  // Mount everything under /api so the frontend's `/api/diff` works straight
  // through Vite's dev proxy in `vite.config.ts`.
  web.setGlobalPrefix('api');

  web.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  // Body size has to be big enough for two raw screenshots in a multipart
  // upload. The default 100kb express limit would reject anything but tiny
  // PNGs, so we lift it via the BODY_SIZE env var (default 60mb).
  const bodySize = configService.get<string>(ENV.BODY_SIZE) || '60mb';
  web.use(json({ limit: bodySize }));
  web.use(urlencoded({ limit: bodySize, extended: true }));

  web.useGlobalFilters(new AllExceptionFilter(configService, logger));

  setupSwagger(web);

  // CORS: accept anything from a configured origin list. The list is a
  // comma-separated env var so production hosts can append their own URLs
  // without code changes. We also wave through hostnames ending in
  // `.vercel.app` so frontend preview deploys "just work".
  const originList = (configService.get<string>(ENV.CORS_ORIGIN) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  web.enableCors({
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

  const port = configService.get(ENV.APP_PORT);
  // Bind to 0.0.0.0 so managed hosts (Railway, Render, fly, Docker, etc.)
  // can route external traffic to the container. Defaulting to localhost
  // would silently break in those environments.
  await web.listen(port, '0.0.0.0');

  logger.log(`Image-diff API listening on ${await web.getUrl()}`);
}

bootstrap();
