import {
  ArgumentsHost,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SafeExceptionFilter } from './safe-exception.filter';

function mockHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('SafeExceptionFilter (ROADMAP.md O14)', () => {
  const filter = new SafeExceptionFilter();
  let logged: string[];

  beforeEach(() => {
    logged = [];
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(
        (...args: unknown[]) => void logged.push(args.map(String).join(' ')),
      );
  });
  afterEach(() => jest.restoreAllMocks());

  it('passes deliberate HTTP errors through unchanged', () => {
    const { host, status, json } = mockHost();
    filter.catch(new ForbiddenException('Insufficient permissions'), host);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        message: 'Insufficient permissions',
      }),
    );
  });

  it('wraps a string-bodied HttpException in the usual {statusCode, message} shape', () => {
    const { host, json } = mockHost();
    const err = new NotFoundException();
    jest.spyOn(err, 'getResponse').mockReturnValue('gone');
    filter.catch(err, host);
    expect(json).toHaveBeenCalledWith({ statusCode: 404, message: 'gone' });
  });

  it('turns an internal error into a generic 500 that leaks nothing', () => {
    const { host, status, json } = mockHost();
    // The kind of message Prisma produces on a unique-constraint hit.
    const leak = new Error(
      'Unique constraint failed on the fields: (`email`) value ana@example.com in table "users"',
    );
    filter.catch(leak, host);

    expect(status).toHaveBeenCalledWith(500);
    const body = (json.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
      errorId: expect.any(String) as unknown,
    });
    expect(JSON.stringify(body)).not.toMatch(/email|users|ana@/);

    // The log keeps what's needed to debug (correlated by errorId), minus the personal data.
    expect(logged.join('\n')).toContain(String(body.errorId));
    expect(logged.join('\n')).toContain('a***@e***.com');
    expect(logged.join('\n')).not.toContain('ana@example.com');
  });
});
