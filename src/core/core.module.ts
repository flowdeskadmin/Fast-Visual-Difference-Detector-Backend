import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { Configuration } from '@/shared/config';

/**
 * Trimmed-down CoreModule for the image-diff app.
 *
 * The original NestJS template wires up Prisma, BullMQ, Redis cache and the
 * upload module. None of those are needed to diff two images, so we keep
 * just the global config + a logger provider. Plug those back in if the
 * project grows beyond a single endpoint.
 */
@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [Configuration] })],
  providers: [Logger, ConfigService],
  exports: [ConfigService, Logger],
})
export class CoreModule {}
