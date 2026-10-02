import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { FieldEncryptionError, FieldEncryptionService } from './field-encryption.service';

/**
 * Global so any module's infrastructure-layer repository can inject
 * FieldEncryptionService (users for the TOTP secret, cards for the owner
 * location used in distance search) without each module re-importing it.
 */
@Global()
@Module({
  providers: [
    {
      provide: FieldEncryptionService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const keyring = config.get('fieldEncryption', { infer: true });
        if (Object.keys(keyring.keys).length === 0) {
          // No fallback key, not even in dev: a key in the source code would
          // defeat the point of encrypting the column.
          throw new FieldEncryptionError(
            'FIELD_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` ' +
              'and put it in .env (dev) — in production it comes from AWS Secrets Manager.',
          );
        }
        return new FieldEncryptionService(keyring);
      },
    },
  ],
  exports: [FieldEncryptionService],
})
export class CryptoModule {}
