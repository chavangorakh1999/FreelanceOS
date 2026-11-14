import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

/** Shared by main.ts and the e2e tests so they exercise identical middleware. */
export function configureApp(app: INestApplication, webOrigin: string): void {
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: webOrigin, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
}
