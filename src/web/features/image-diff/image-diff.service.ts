import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';

import { computeDiff, type ServerBox } from './image-diff.algorithm';

export type DiffServiceInput = {
  beforeBuffer: Buffer;
  afterBuffer: Buffer;
  sensitivity: number;
  ignoreAntialiasing: boolean;
};

export type DiffServiceOutput = {
  width: number;
  height: number;
  boxes: ServerBox[];
  changedPixels: number;
  durationMs: number;
  dimensionMismatch: boolean;
};

@Injectable()
export class ImageDiffService {
  async diff(input: DiffServiceInput): Promise<DiffServiceOutput> {
    const { beforeBuffer, afterBuffer, sensitivity, ignoreAntialiasing } = input;

    // sharp decodes formats natively (libvips), which is dramatically faster
    // and more memory-efficient than a pure-JS decoder. We force RGBA so the
    // pixelmatch buffer is exactly width*height*4 bytes and no per-pixel
    // alpha conversion is needed downstream.
    const beforeImg = sharp(beforeBuffer);
    const afterImg = sharp(afterBuffer);

    const [beforeMeta, afterMeta] = await Promise.all([
      beforeImg.metadata(),
      afterImg.metadata(),
    ]);

    if (!beforeMeta.width || !beforeMeta.height || !afterMeta.width || !afterMeta.height) {
      throw new BadRequestException('Could not read image dimensions.');
    }

    const width = Math.max(beforeMeta.width, afterMeta.width);
    const height = Math.max(beforeMeta.height, afterMeta.height);
    const dimensionMismatch =
      beforeMeta.width !== afterMeta.width || beforeMeta.height !== afterMeta.height;

    // Pad each image to the union dimensions with transparent pixels so the
    // "extra" area on the larger image gets flagged as a difference (same
    // behaviour as the client-side runner).
    const [beforeRaw, afterRaw] = await Promise.all([
      this.toPaddedRaw(beforeImg, beforeMeta.width, beforeMeta.height, width, height),
      this.toPaddedRaw(afterImg, afterMeta.width, afterMeta.height, width, height),
    ]);

    const start = performance.now();
    const { boxes, changedPixels } = computeDiff({
      before: beforeRaw,
      after: afterRaw,
      width,
      height,
      sensitivity,
      ignoreAntialiasing,
    });
    const durationMs = performance.now() - start;

    return {
      width,
      height,
      boxes,
      changedPixels,
      durationMs,
      dimensionMismatch,
    };
  }

  private async toPaddedRaw(
    img: sharp.Sharp,
    srcWidth: number,
    srcHeight: number,
    targetWidth: number,
    targetHeight: number,
  ): Promise<Buffer> {
    let pipeline = img.clone().ensureAlpha();
    if (srcWidth !== targetWidth || srcHeight !== targetHeight) {
      pipeline = pipeline.extend({
        top: 0,
        left: 0,
        right: targetWidth - srcWidth,
        bottom: targetHeight - srcHeight,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
    }
    return pipeline.raw().toBuffer();
  }
}
