export interface Env {
  databaseUrl: string;
  jwtAccessSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  webOrigin: string;
  port: number;
  nodeEnv: string;
  emailProvider: 'log' | 'smtp';
  smtpUrl: string | undefined;
  emailFrom: string;
  /** Runs the outbox + reminder loop inside the API process. Off in tests (they drive it directly). */
  emailWorker: boolean;
  /** Private file storage root for documents. Never served directly. */
  storageDir: string;
  maxUploadBytes: number;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const need = (k: string): string => {
    const v = source[k];
    if (!v) throw new Error(`Missing required environment variable ${k}`);
    return v;
  };
  if (source.EMAIL_PROVIDER === 'smtp' && !source.SMTP_URL) throw new Error('SMTP_URL is required when EMAIL_PROVIDER=smtp');
  const secret = need('JWT_ACCESS_SECRET');
  if (secret.length < 32) throw new Error('JWT_ACCESS_SECRET must be at least 32 characters');
  return {
    databaseUrl: need('DATABASE_URL'),
    jwtAccessSecret: secret,
    accessTtlSeconds: Number(source.ACCESS_TOKEN_TTL_SECONDS ?? 900),
    refreshTtlDays: Number(source.REFRESH_TOKEN_TTL_DAYS ?? 30),
    webOrigin: source.WEB_ORIGIN ?? 'http://localhost:3000',
    port: Number(source.PORT ?? 4000),
    nodeEnv: source.NODE_ENV ?? 'development',
    emailProvider: source.EMAIL_PROVIDER === 'smtp' ? 'smtp' : 'log',
    smtpUrl: source.SMTP_URL,
    emailFrom: source.EMAIL_FROM ?? 'FreelanceOS <no-reply@localhost>',
    emailWorker: (source.EMAIL_WORKER ?? 'on') !== 'off',
    storageDir: source.STORAGE_DIR ?? './var/storage',
    maxUploadBytes: Number(source.MAX_UPLOAD_MB ?? 20) * 1024 * 1024,
  };
}
