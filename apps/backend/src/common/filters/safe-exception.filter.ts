import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { redactPersonalData } from '../privacy/redact';

/**
 * Safe error handling (ROADMAP.md O14, docs/security/ACTIVIDAD_4.md §4).
 *
 * - HttpExceptions (400/401/403/404/409...) are messages this code wrote on
 *   purpose — passed through unchanged.
 * - Anything else (a Prisma error, a TypeError, a decryption failure...) is
 *   a bug or an infrastructure fault, and its message can carry table and
 *   column names, constraint names, a SQL fragment or the offending value
 *   itself (e.g. Prisma's P2002 names the unique field). The client gets a
 *   generic 500 with an opaque errorId; the log gets that same errorId, the
 *   error's class, its message with personal data redacted, and the stack —
 *   never the request body, headers or query string.
 *
 * Registered as APP_FILTER in AppModule, so it also covers the e2e tests'
 * app instances, not just main.ts.
 */
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('SafeExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception; // WS gateway errors keep socket.io's own handling

    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // Same shape Nest's own BaseExceptionFilter produces for a string body.
      res
        .status(status)
        .json(
          typeof body === 'string'
            ? { statusCode: status, message: body }
            : body,
        );
      return;
    }

    const errorId = randomUUID();
    const err =
      exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(
      `[${errorId}] ${err.name}: ${redactPersonalData(err.message)}`,
      err.stack ? redactPersonalData(err.stack) : undefined,
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      errorId,
    });
  }
}
