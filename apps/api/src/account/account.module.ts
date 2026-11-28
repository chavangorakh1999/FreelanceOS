import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BrandingService } from './branding.service';
import { PasswordResetController, PortalBrandingController, ProfileController } from './account.controller';
import { PasswordResetService } from './password-reset.service';
import { ProfileService } from './profile.service';

@Global()
@Module({ imports: [JwtModule.register({})], controllers: [ProfileController, PasswordResetController, PortalBrandingController], providers: [ProfileService, PasswordResetService, BrandingService], exports: [BrandingService] })
export class AccountModule {}
