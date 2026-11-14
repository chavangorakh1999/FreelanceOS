import { Module } from '@nestjs/common';
import { AgreementsModule } from '../agreements/agreements.module';
import { AuthModule } from '../auth/auth.module';
import { ChangeRequestsModule } from '../change-requests/change-requests.module';
import { CommentsModule } from '../comments/comments.module';
import { ProposalsModule } from '../proposals/proposals.module';
import { ScopeModule } from '../scope/scope.module';
import { PortalAdminController } from './portal-admin.controller';
import { PortalAdminService } from './portal-admin.service';
import { PortalDataController } from './portal-data.controller';
import { PortalDataService } from './portal-data.service';
import { PortalAuthController } from './portal-auth.controller';
import { PortalAuthService } from './portal-auth.service';
import { PortalGuard } from './portal.guard';

@Module({
  imports: [AuthModule, AgreementsModule, ChangeRequestsModule, CommentsModule, ProposalsModule, ScopeModule],
  controllers: [PortalAuthController, PortalAdminController, PortalDataController],
  providers: [PortalAuthService, PortalAdminService, PortalDataService, PortalGuard],
  exports: [PortalGuard, PortalAuthService],
})
export class PortalModule {}
