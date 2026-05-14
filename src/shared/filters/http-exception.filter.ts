import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { APP_ENV, ENV, LOGGER_CONTEXT } from '../enums';

@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof Error ? exception.message : 'Internal Server Error';

    const result: Record<string, unknown> = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    };

    if (exception && typeof exception === 'object' && 'response' in exception) {
      result.body = (exception as { response: unknown }).response;
    }

    if (this.configService.get<string>(ENV.APP_ENV) === APP_ENV.DEV) {
      result.error = exception;
    }

    this.logger.error(exception, '', LOGGER_CONTEXT.WEB);

    response.status(status).json(result);
  }
}
