import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuditService } from '../audit/audit.service';
import {
  hasPermission,
  Permission,
  ROLE_PERMISSIONS,
  ROLES,
  type Role,
} from './permissions';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS_KEY } from './require-permissions.decorator';

// The RBAC matrix of docs/security/ACTIVIDAD_4.md §3, as executable truth:
// if someone widens a role in permissions.ts, this table has to change too.
const EXPECTED: Record<Permission, Record<Role, boolean>> = {
  [Permission.USERS_LIST]: { USER: false, SUPPORT: true, ADMIN: true },
  [Permission.ROLES_MANAGE]: { USER: false, SUPPORT: false, ADMIN: true },
  [Permission.TRANSACTIONS_READ_ANY]: {
    USER: false,
    SUPPORT: true,
    ADMIN: true,
  },
  [Permission.AUDIT_READ]: { USER: false, SUPPORT: false, ADMIN: true },
  [Permission.REPORTS_READ]: { USER: false, SUPPORT: false, ADMIN: true },
  [Permission.PSEUDONYM_RESOLVE]: { USER: false, SUPPORT: false, ADMIN: true },
};

describe('RBAC matrix (ROADMAP.md O14)', () => {
  for (const permission of Object.values(Permission)) {
    for (const role of ROLES) {
      const allowed = EXPECTED[permission][role];
      it(`${role} ${allowed ? 'may' : 'may NOT'} ${permission}`, () => {
        expect(hasPermission(role, permission)).toBe(allowed);
      });
    }
  }

  it('USER holds no elevated permission at all (self-service is ownership, not RBAC)', () => {
    expect(ROLE_PERMISSIONS.USER).toEqual([]);
  });

  it('an unknown role gets nothing (fail closed)', () => {
    expect(hasPermission('ROOT' as Role, Permission.USERS_LIST)).toBe(false);
  });
});

describe('PermissionsGuard', () => {
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;
  const reflector = new Reflector();

  function contextFor(
    user: { id: string; role: Role } | undefined,
    required?: Permission[],
  ) {
    const handler = () => undefined;
    if (required) Reflect.defineMetadata(PERMISSIONS_KEY, required, handler);
    return {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          method: 'GET',
          route: { path: '/admin/users' },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  const guard = new PermissionsGuard(reflector, audit);
  beforeEach(() => record.mockClear());

  it('lets through a route that declares no permission', async () => {
    await expect(
      guard.canActivate(contextFor({ id: 'u1', role: 'USER' })),
    ).resolves.toBe(true);
  });

  it('allows a role that holds the permission, without auditing', async () => {
    await expect(
      guard.canActivate(
        contextFor({ id: 'a1', role: 'ADMIN' }, [Permission.AUDIT_READ]),
      ),
    ).resolves.toBe(true);
    expect(record).not.toHaveBeenCalled();
  });

  it('denies a role without it with a generic 403 and records the attempt', async () => {
    await expect(
      guard.canActivate(
        contextFor({ id: 's1', role: 'SUPPORT' }, [Permission.ROLES_MANAGE]),
      ),
    ).rejects.toThrow(new ForbiddenException('Insufficient permissions'));
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 's1',
        actorRole: 'SUPPORT',
        outcome: 'DENIED',
      }),
    );
  });

  it('requires every listed permission (AND)', async () => {
    await expect(
      guard.canActivate(
        contextFor({ id: 's1', role: 'SUPPORT' }, [
          Permission.USERS_LIST,
          Permission.AUDIT_READ,
        ]),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('fails closed when no authenticated user is on the request', async () => {
    await expect(
      guard.canActivate(contextFor(undefined, [Permission.USERS_LIST])),
    ).rejects.toThrow(ForbiddenException);
  });
});
