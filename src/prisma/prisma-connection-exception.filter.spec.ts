import { HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { describe, expect, it, jest } from '@jest/globals';
import { PrismaConnectionExceptionFilter } from './prisma-connection-exception.filter';

describe('PrismaConnectionExceptionFilter', () => {
  const createHost = () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const response = { status } as unknown as Response;
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as ArgumentsHost;

    return { host, json, status };
  };

  it('returns a retryable service-unavailable response for P1017', () => {
    const filter = new PrismaConnectionExceptionFilter();
    const { host, json, status } = createHost();
    const error = new Prisma.PrismaClientKnownRequestError(
      'Server has closed the connection',
      { code: 'P1017', clientVersion: '7.10.1' },
    );

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        retryable: true,
      }),
    );
  });

  it('does not expose other Prisma errors to clients', () => {
    const filter = new PrismaConnectionExceptionFilter();
    const { host, json, status } = createHost();
    const error = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '7.10.1' },
    );

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  });
});
