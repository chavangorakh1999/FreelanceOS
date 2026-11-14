import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import { requestContext } from './observability/request-context';

/** Shared by main.ts and the e2e tests so they exercise identical middleware. */
export function configureApp(app: INestApplication, webOrigin: string): void {
  app.use(requestContext({ log: process.env.NODE_ENV !== 'test' && process.env.LOG_REQUESTS !== 'off' }));
  app.use(helmet());
  // JSON lists compress roughly tenfold; file downloads are already compressed formats and are skipped by size and type rules.
  app.use(compression({ threshold: 2048 }));
  app.use(cookieParser());
  app.enableCors({ origin: webOrigin, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
}
