import { SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Use together with `@UseGuards(JwtAuthGuard, PermissionsGuard)` — the JWT
 * guard has to run first so req.user (and its role) exists. Every listed
 * permission is required (AND, not OR).
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
