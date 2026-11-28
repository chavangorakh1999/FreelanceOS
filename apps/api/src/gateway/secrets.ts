import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** AES-256-GCM for small secrets at rest: iv.tag.ciphertext, base64url. The key never leaves the server. */
export class SecretBox {
  private readonly key: Buffer;
  constructor(secretsKey: string | undefined, fallbackSecret: string) {
    const k = secretsKey ? Buffer.from(secretsKey, 'base64') : createHash('sha256').update(`freelanceos-secrets:${fallbackSecret}`).digest();
    if (k.length !== 32) throw new Error('SECRETS_KEY must be 32 bytes, base64-encoded');
    this.key = k;
  }
  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
  }
  open(sealed: string): string {
    const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
    const d = createDecipheriv('aes-256-gcm', this.key, iv!);
    d.setAuthTag(tag!);
    return Buffer.concat([d.update(body!), d.final()]).toString('utf8');
  }
}
