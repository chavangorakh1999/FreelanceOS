import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** Stable, machine-readable error (PRD §13: stable error codes, actionable messages). */
export class DomainError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what: string) => new DomainError('NOT_FOUND', `${what} not found`, HttpStatus.NOT_FOUND);

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly log = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: { code: string; message: string; details?: unknown } = {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong',
    };

    if (exception instanceof DomainError) {
      status = exception.getStatus();
      body = { code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse() as string | { message?: string | string[]; error?: string };
      if (typeof r === 'object' && Array.isArray(r.message)) {
        body = { code: 'VALIDATION_FAILED', message: 'Request validation failed', details: r.message };
      } else {
        const message = typeof r === 'string' ? r : (r.message as string) ?? exception.message;
        const code =
          status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR';
        body = { code, message };
      }
    } else if (isIntegrityViolation(exception)) {
      // A database rule (immutability, over-allocation, …) caught something the service pre-checks missed, e.g. a race.
      status = HttpStatus.CONFLICT;
      body = { code: 'INTEGRITY_RULE', message: integrityMessage(exception) };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        body = { code: 'CONFLICT', message: 'A record with these values already exists' };
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        body = { code: 'NOT_FOUND', message: 'Record not found' };
      } else {
        this.log.error(exception);
      }
    } else {
      this.log.error(exception);
    }

    res.status(status).json({ error: body });
  }
}

const raised = (e: unknown): string => (e instanceof Error ? e.message : '');
const isIntegrityViolation = (e: unknown): boolean =>
  (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError) && /restrict_violation|23001/.test(raised(e));
const integrityMessage = (e: unknown): string => /ERROR: ([^\n`]+)/.exec(raised(e))?.[1]?.trim() ?? 'That change would break a financial integrity rule';
