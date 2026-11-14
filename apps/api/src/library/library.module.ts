import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PortalModule } from '../portal/portal.module';
import { LibraryController, PortalLibraryController } from './library.controller';
import { LibraryService } from './library.service';
import { FILE_STORAGE, LocalDiskStorage, NoopScanner, UPLOAD_SCANNER } from './storage';

@Module({
  imports: [AuthModule, PortalModule],
  controllers: [LibraryController, PortalLibraryController],
  providers: [
    LibraryService,
    { provide: FILE_STORAGE, inject: [ENV], useFactory: (env: Env) => new LocalDiskStorage(env.storageDir) },
    { provide: UPLOAD_SCANNER, useClass: NoopScanner },
  ],
  exports: [FILE_STORAGE],
})
export class LibraryModule {}
