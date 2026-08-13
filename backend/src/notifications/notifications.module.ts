import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { SmtpEmailProvider } from './providers/smtp-email.provider';
import { SesEmailProvider } from './providers/ses-email.provider';
import { NotificationsService } from './notifications.service';
import { UserCreatedListener } from './listeners/user-created.listener';

@Module({
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
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
