import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PortalModule } from '../portal/portal.module';
import { LibraryController, PortalLibraryController } from './library.controller';
import { LibraryService } from './library.service';

@Module({
  imports: [AuthModule, PortalModule],
  controllers: [LibraryController, PortalLibraryController],
  providers: [LibraryService],
})
export class LibraryModule {}
