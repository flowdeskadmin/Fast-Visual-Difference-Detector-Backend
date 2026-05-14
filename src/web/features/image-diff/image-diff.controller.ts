import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { MulterField } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

import { ENV } from '../../../shared/enums';

import { ImageDiffService } from './image-diff.service';

type DiffBody = {
  sensitivity?: string;
  ignoreAntialiasing?: string;
};

/**
 * Image diff endpoint. Accepts the two images as multipart form fields
 * (`before` and `after`) plus a few scalar tuning params. The response
 * matches the shape consumed by `frontend/src/lib/diff/runServerDiff.ts`.
 *
 * Limits and concerns:
 *   - Each file is capped at MAX_IMAGE_BYTES (default 30 MB). The body
 *     parser limit is configured separately (BODY_SIZE) and should be at
 *     least 2x the per-file limit since the request carries both files.
 *   - The service decodes images via `sharp` which streams through libvips
 *     and therefore handles >50 MP screenshots without blowing the heap.
 *   - We don't persist anything; both files live in memory for the duration
 *     of the request and are GC'd as soon as the response is sent.
 */
@Controller('diff')
@ApiTags('Image Diff')
export class ImageDiffController {
  constructor(
    private readonly service: ImageDiffService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Diff two images and return bounding boxes.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['before', 'after'],
      properties: {
        before: { type: 'string', format: 'binary' },
        after: { type: 'string', format: 'binary' },
        sensitivity: { type: 'string', example: '60' },
        ignoreAntialiasing: { type: 'string', example: 'true' },
      },
    },
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'before', maxCount: 1 },
        { name: 'after', maxCount: 1 },
      ] as MulterField[],
      {
        limits: {
          // Generous default; the per-file cap is enforced again in the
          // handler against the env-configured ceiling.
          fileSize: 64 * 1024 * 1024,
          files: 2,
        },
      },
    ),
  )
  async diff(
    @UploadedFiles()
    files: { before?: Express.Multer.File[]; after?: Express.Multer.File[] },
    @Body() body: DiffBody,
  ) {
    const before = files.before?.[0];
    const after = files.after?.[0];
    if (!before || !after) {
      throw new BadRequestException(
        'Both `before` and `after` files are required as multipart fields.',
      );
    }

    const maxBytes = this.config.get<number>(ENV.MAX_IMAGE_BYTES) ?? 30 * 1024 * 1024;
    if (before.size > maxBytes || after.size > maxBytes) {
      throw new BadRequestException(
        `Image exceeds the ${(maxBytes / (1024 * 1024)).toFixed(0)} MB limit.`,
      );
    }

    const sensitivity = clampSensitivity(body?.sensitivity);
    const ignoreAntialiasing = body?.ignoreAntialiasing !== 'false';

    return this.service.diff({
      beforeBuffer: before.buffer,
      afterBuffer: after.buffer,
      sensitivity,
      ignoreAntialiasing,
    });
  }
}

function clampSensitivity(value: string | undefined): number {
  const parsed = Number(value ?? '60');
  if (!Number.isFinite(parsed)) return 60;
  if (parsed < 0) return 0;
  if (parsed > 100) return 100;
  return parsed;
}
