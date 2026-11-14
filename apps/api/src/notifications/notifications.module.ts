import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EMAIL_PROVIDER, EmailProvider, LogEmailProvider, SmtpEmailProvider } from './email/provider';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { OutboxService, OutboxWorker } from './outbox.worker';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService, OutboxService, OutboxWorker,
    { provide: EMAIL_PROVIDER, inject: [ENV], useFactory: (env: Env): EmailProvider => (env.emailProvider === 'smtp' ? new SmtpEmailProvider(env.smtpUrl!, env.emailFrom) : new LogEmailProvider()) },
  ],
  exports: [NotificationsService, OutboxService, EMAIL_PROVIDER],
})
export class NotificationsModule {}
