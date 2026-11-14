import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { FILE_STORAGE, LocalDiskStorage, NoopScanner, UPLOAD_SCANNER } from './storage';

/** Private file storage for everything that keeps files: documents and signature images. */
@Global()
@Module({
  providers: [
    { provide: FILE_STORAGE, inject: [ENV], useFactory: (env: Env) => new LocalDiskStorage(env.storageDir) },
    { provide: UPLOAD_SCANNER, useClass: NoopScanner },
  ],
  exports: [FILE_STORAGE, UPLOAD_SCANNER],
})
export class StorageModule {}
