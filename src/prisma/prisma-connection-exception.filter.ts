import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

const connectionErrorCodes = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
]);

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaConnectionExceptionFilter
  implements ExceptionFilter<Prisma.PrismaClientKnownRequestError>
{
  private readonly logger = new Logger(PrismaConnectionExceptionFilter.name);

  catch(
    exception: Prisma.PrismaClientKnownRequestError,
    host: ArgumentsHost,
  ) {
    const response = host.switchToHttp().getResponse<Response>();
    if (connectionErrorCodes.has(exception.code)) {
      this.logger.warn(
        `Database connection failure (${exception.code}); request returned 503`,
      );
      return response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        message:
          'The database connection was interrupted. Please try again shortly. If the problem continues, check that the database is online and the backend can reach it.',
        retryable: true,
      });
    }

    this.logger.error(
      `Unhandled Prisma request error (${exception.code})`,
      exception.stack,
    );
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
