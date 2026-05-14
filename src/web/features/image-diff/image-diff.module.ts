import { Module } from '@nestjs/common';

import { ImageDiffController } from './image-diff.controller';
import { ImageDiffService } from './image-diff.service';

@Module({
  controllers: [ImageDiffController],
  providers: [ImageDiffService],
})
export class ImageDiffModule {}
