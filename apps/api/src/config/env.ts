export interface Env {
  databaseUrl: string;
  jwtAccessSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  webOrigin: string;
  port: number;
  nodeEnv: string;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const need = (k: string): string => {
    const v = source[k];
    if (!v) throw new Error(`Missing required environment variable ${k}`);
    return v;
  };
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
  };
}
