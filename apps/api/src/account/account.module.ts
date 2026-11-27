import { Module } from '@nestjs/common';
import { PasswordResetController, ProfileController } from './account.controller';
import { PasswordResetService } from './password-reset.service';
import { ProfileService } from './profile.service';

@Module({ controllers: [ProfileController, PasswordResetController], providers: [ProfileService, PasswordResetService] })
export class AccountModule {}
