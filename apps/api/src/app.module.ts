import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ClientsModule } from './clients/clients.module';
import { AuthGuard } from './common/auth';
import { ErrorEnvelopeFilter } from './common/errors';
import { AppConfigModule } from './config/config.module';
import { DashboardController } from './dashboard/dashboard.controller';
import { EngagementsModule } from './engagements/engagements.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { NumberSequenceService } from './sequences/number-sequence.service';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
      // Only honoured under NODE_ENV=test so it can never weaken a deployed instance.
      skipIf: () => process.env.NODE_ENV === 'test' && process.env.THROTTLE_DISABLED === 'true',
    }),
    AuditModule,
    AuthModule,
    ClientsModule,
    EngagementsModule,
  ],
  controllers: [HealthController, DashboardController],
  providers: [
    NumberSequenceService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
  exports: [NumberSequenceService],
})
export class AppModule {}
