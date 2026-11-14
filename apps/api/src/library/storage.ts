import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export const FILE_STORAGE = Symbol('FILE_STORAGE');

/**
 * Private object storage behind one interface (PRD §7.11): local disk in development and single-host installs,
 * an S3-compatible bucket later. Keys are random and never shown to anyone; bytes leave only through an
 * authenticated download endpoint.
 */
export interface FileStorage {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export class LocalDiskStorage implements FileStorage {
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }

  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('invalid storage key'); // keys are generated, but never trust a path
    return p;
  }

  async put(key: string, bytes: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true, mode: 0o700 });
    await writeFile(p, bytes, { flag: 'wx', mode: 0o600 }); // never overwrite: versions are immutable
  }

  get(key: string) { return readFile(this.path(key)); }
}

/** Malware scanning hook (PRD §7.11 "where supported"). The default accepts everything; swap in a real scanner here. */
export interface UploadScanner { scan(bytes: Buffer, fileName: string): Promise<{ clean: boolean; reason?: string }> }
export const UPLOAD_SCANNER = Symbol('UPLOAD_SCANNER');
export class NoopScanner implements UploadScanner { async scan() { return { clean: true }; } }
