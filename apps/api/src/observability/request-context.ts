import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { metrics } from './metrics';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Gives every request an id (kept from a trusted proxy's X-Request-Id when well-formed), returns it in the response,
 * and writes one structured log line when the response finishes. The line carries the route pattern, never the URL,
 * query string, body, headers or user data, so search terms, emails and tokens never reach the logs (PRD §10.1).
 */
export function requestContext(opts: { log: boolean }) {
  return (req: Request & { id?: string }, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    req.id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = (req.route?.path as string | undefined) ? `${req.baseUrl ?? ''}${req.route.path as string}` : 'unmatched';
      metrics.observe(req.method, route, res.statusCode, seconds);
      if (opts.log) {
        process.stdout.write(JSON.stringify({
          t: new Date().toISOString(), level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', msg: 'request',
          id: req.id, method: req.method, route, status: res.statusCode, ms: Math.round(seconds * 1000),
        }) + '\n');
      }
    });
    next();
  };
}
