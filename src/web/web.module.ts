import { Logger, MiddlewareConsumer, Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { CoreModule } from '@/core/core.module';
import { HealthcheckModule } from '@/core/healthcheck/healthcheck.module';
import { RequestLoggerMiddleware } from '@/shared/middlewares';

import { FeaturesModule } from './features/features.module';

@Module({
  imports: [
    CoreModule,
    HealthcheckModule,
    FeaturesModule,
    // Serve the friendly landing page (and favicon) at `/`. The /api/*
    // routes are mounted via setGlobalPrefix and don't go through this
    // module, so there's no path collision.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'public'),
      serveRoot: '/',
      exclude: ['/api*'],
    }),
  ],
  controllers: [],
  providers: [Logger],
})
export class WebModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
