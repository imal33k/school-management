import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { PrismaConnectionExceptionFilter } from './prisma/prisma-connection-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const logger = new Logger('CORS');

  // The web app calls this API from its own server, so without this every visitor
  // shares one IP and rate limits (login, enquiries) would apply to everyone at once.
  // Set TRUST_PROXY=1 when the API is only reachable through the web app / a proxy.
  if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    app.set('trust proxy', Number.isInteger(hops) && hops > 0 ? hops : true);
  }

  app.use(helmet());
  app.useGlobalFilters(new PrismaConnectionExceptionFilter());

  const configuredOrigins = [
    ...(process.env.CORS_ORIGINS ?? '').split(','),
    process.env.FRONTEND_URL ?? '',
    'http://localhost:5173',
    'http://localhost:4173',
  ]
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set(
    configuredOrigins.map((origin) => {
      try {
        const parsed = new URL(origin);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new Error();
        }
        return parsed.origin;
      } catch {
        throw new Error(`Invalid CORS origin configuration: ${origin}`);
      }
    }),
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      let requestOrigin: string;
      try {
        requestOrigin = new URL(origin).origin;
      } catch {
        logger.warn(`Rejected malformed request origin: ${origin}`);
        callback(null, false);
        return;
      }
      const parsedOrigin = new URL(requestOrigin);
      const isLocalDevelopmentOrigin =
        process.env.NODE_ENV !== 'production' &&
        parsedOrigin.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(parsedOrigin.hostname);
      const allowed =
        allowedOrigins.has(requestOrigin) || isLocalDevelopmentOrigin;
      if (!allowed) {
        logger.warn(
          `Blocked origin ${requestOrigin}; add it to CORS_ORIGINS and restart the API`,
        );
      }
      callback(null, allowed);
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();