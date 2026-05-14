/**
 * Vercel serverless entry point.
 *
 * Boots NestJS once per warm container and caches the resulting Express
 * handler so subsequent invocations skip the ~300 ms NestFactory init.
 *
 * Notes for portability:
 *
 *   - This file is the *only* Vercel-specific piece of code. Delete the
 *     `api/` folder and `vercel.json` and the project deploys to
 *     Railway / Render / fly.io / Docker / a plain VPS unchanged via
 *     `npm run prod` (which uses `src/web.ts`).
 *   - We use plain Node `http` types so there's no `@vercel/node`
 *     dependency. Vercel's runtime provides Express-compatible
 *     `req`/`res` objects at runtime; the small cast below is safe
 *     because Express only reads the subset of fields that
 *     `IncomingMessage`/`ServerResponse` guarantee.
 *   - The slim `buildApp()` from `../src/bootstrap.ts` is shared with
 *     `src/web.ts` so CORS / body limits / global pipes can never drift
 *     between the two deploy paths.
 */

import 'reflect-metadata';

import { ExpressAdapter } from '@nestjs/platform-express';
import express, { type Express } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';

import { buildApp } from '../src/bootstrap';

let cachedApp: Express | undefined;
let bootPromise: Promise<Express> | undefined;

async function getApp(): Promise<Express> {
  if (cachedApp) return cachedApp;
  if (!bootPromise) {
    bootPromise = (async () => {
      const expressApp = express();
      const nest = await buildApp(new ExpressAdapter(expressApp));
      await nest.init();
      cachedApp = expressApp;
      return expressApp;
    })();
  }
  return bootPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  // Express expects its own augmented request/response, but at runtime
  // it only reads fields that exist on the standard Node types. Vercel
  // passes through compatible objects.
  return app(req as unknown as express.Request, res as unknown as express.Response);
}

/**
 * Disable Vercel's built-in body parser — the NestJS app installs its
 * own (with a much larger limit for multipart image uploads) inside
 * `buildApp()`. Without this, Vercel would consume the request body
 * before NestJS gets a chance.
 */
export const config = {
  api: {
    bodyParser: false,
  },
};
