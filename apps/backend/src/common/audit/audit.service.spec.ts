import { randomBytes } from 'node:crypto';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '../../prisma/prisma.service';
import { PseudonymService } from '../privacy/pseudonym.service';
import { ANONYMOUS_ACTOR, AuditService } from './audit.service';

// ROADMAP.md O15 / ACTIVIDAD_5.md §3.3 — what must never reach the audit log.
describe('AuditService.record', () => {
  const created: Record<string, unknown>[] = [];
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    auditLog: {
      findFirst: jest.fn().mockResolvedValue({ hash: 'a'.repeat(64) }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve(data);
      }),
    },
  };
  const prisma = {
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaService;
  const emitAsync = jest.fn().mockResolvedValue([]);
  const service = new AuditService(
    prisma,
    new PseudonymService(randomBytes(32).toString('base64')),
    { emitAsync } as unknown as EventEmitter2,
  );

  beforeEach(() => {
    created.length = 0;
    emitAsync.mockClear();
  });

  it('stores pseudonyms, never the raw user id', async () => {
    await service.record({
      actorId: '11111111-1111-1111-1111-111111111111',
      actorRole: 'USER',
      action: 'data.export',
      targetId: '22222222-2222-2222-2222-222222222222',
      outcome: 'ALLOWED',
    });
    const dump = JSON.stringify(created);
    expect(dump).not.toContain('11111111-1111');
    expect(dump).not.toContain('22222222-2222');
    expect(created[0].actorPseudonym).toMatch(/^u_[0-9a-f]{16}$/);
  });

  it('masks emails and strips tokens and phone numbers that slip into a reason', async () => {
    await service.record({
      actorId: ANONYMOUS_ACTOR,
      actorRole: null,
      action: 'auth.login',
      reason:
        'from jugador@example.com Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl call +56 9 1234 5678',
      outcome: 'FAILED',
    });
    const reason = created[0].reason as string;
    expect(reason).not.toContain('jugador@example.com');
    expect(reason).not.toContain('eyJ');
    expect(reason).not.toContain('1234 5678');
    expect(created[0].actorPseudonym).toBe('anonymous');
  });

  it('chains each row to the previous hash', async () => {
    await service.record({
      actorId: 'system',
      actorRole: null,
      action: 'x',
      outcome: 'ALLOWED',
    });
    expect(created[0].prevHash).toBe('a'.repeat(64));
    expect(created[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hands every recorded event to detection', async () => {
    await service.record({
      actorId: 'u',
      actorRole: 'USER',
      action: 'auth.login',
      outcome: 'FAILED',
    });
    expect(emitAsync).toHaveBeenCalledWith(
      'audit.recorded',
      expect.objectContaining({ action: 'auth.login' }),
    );
  });

  it('a failing write never throws into the request that caused it', async () => {
    tx.auditLog.create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.record({
        actorId: 'u',
        actorRole: 'USER',
        action: 'x',
        outcome: 'DENIED',
      }),
    ).resolves.toBeUndefined();
    expect(emitAsync).not.toHaveBeenCalled();
  });
});
