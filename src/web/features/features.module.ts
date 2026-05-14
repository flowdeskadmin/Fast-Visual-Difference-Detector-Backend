import { Module } from '@nestjs/common';

import { ImageDiffModule } from './image-diff/image-diff.module';

@Module({
  imports: [ImageDiffModule],
})
export class FeaturesModule {}
