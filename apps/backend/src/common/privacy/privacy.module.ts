import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { PseudonymKeyError, PseudonymService } from './pseudonym.service';

/**
 * Global for the same reason as CryptoModule: the audit log, the offers
 * module (bidder aliases) and the admin module all pseudonymize, and none of
 * them should need to re-import this.
 */
@Global()
@Module({
  providers: [
    {
      provide: PseudonymService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const key = config.get('privacy', { infer: true }).pseudonymKey;
        if (!key) {
          // No fallback key, not even in dev — same rule as FIELD_ENCRYPTION_KEY:
          // a key in the source code would make every pseudonym reversible.
          throw new PseudonymKeyError(
            'PSEUDONYM_KEY is not set. Generate one with `openssl rand -base64 32` ' +
              'and put it in .env (dev) — in production it comes from AWS Secrets Manager.',
          );
        }
        return new PseudonymService(key);
      },
    },
  ],
  exports: [PseudonymService],
})
export class PrivacyModule {}
