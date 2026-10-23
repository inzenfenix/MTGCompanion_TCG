import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { SmtpEmailProvider } from './providers/smtp-email.provider';
import { SesEmailProvider } from './providers/ses-email.provider';
import { NotificationsService } from './notifications.service';
import { UserCreatedListener } from './listeners/user-created.listener';
import { TransactionPaidListener } from './listeners/transaction-paid.listener';
import { PrivacyListeners } from './listeners/privacy.listeners';
import { ConsentModule } from '../consent/consent.module';
import { UsersModule } from '../users/users.module';

@Module({
  // O15: the optional offer email checks consent and looks up the seller.
  imports: [ConsentModule, UsersModule],
  providers: [
    SmtpEmailProvider,
    SesEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      useFactory: (
        config: ConfigService<AppConfig, true>,
        smtp: SmtpEmailProvider,
        ses: SesEmailProvider,
      ) =>
        config.get('email', { infer: true }).provider === 'ses' ? ses : smtp,
      inject: [ConfigService, SmtpEmailProvider, SesEmailProvider],
    },
    NotificationsService,
    UserCreatedListener,
    TransactionPaidListener,
    PrivacyListeners,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
