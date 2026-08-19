import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';

/**
 * ROADMAP.md L6 — the only guard on a dev-only route (no JWT: this is a
 * global, not user-scoped, action). Blocks unless NODE_ENV !== 'production',
 * so a dev-tools endpoint like CouponsController's devResetAll() can never
 * accidentally be reachable against a real deployed backend with real
 * users' data, no matter what desktop-runner's AwsTab.tsx points at.
 */
@Injectable()
export class DevOnlyGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  canActivate(): boolean {
    if (this.config.get('nodeEnv', { infer: true }) === 'production') {
      throw new ForbiddenException('Not available in production');
    }
    return true;
  }
}
