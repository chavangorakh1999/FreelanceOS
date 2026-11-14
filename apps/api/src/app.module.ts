import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AgreementsModule } from './agreements/agreements.module';
import { ChangeRequestsModule } from './change-requests/change-requests.module';
import { ProjectsModule } from './projects/projects.module';
import { ScopeModule } from './scope/scope.module';
import { FinanceModule } from './finance/finance.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PortalModule } from './portal/portal.module';
import { CommentsModule } from './comments/comments.module';
import { SearchModule } from './search/search.controller';
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
import { DocumentsModule } from './documents/documents.module';
import { ProposalsModule } from './proposals/proposals.module';
import { SequencesModule } from './sequences/sequences.module';
import { TemplatesModule } from './templates/templates.module';

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
    SequencesModule,
    TemplatesModule,
    DocumentsModule,
    ProposalsModule,
    AgreementsModule,
    ProjectsModule,
    ScopeModule,
    ChangeRequestsModule,
    FinanceModule,
    NotificationsModule,
    PortalModule,
    CommentsModule,
    SearchModule,
  ],
  controllers: [HealthController, DashboardController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
})
export class AppModule {}
