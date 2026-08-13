import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_PROVIDER, type EmailProvider } from './email-provider.interface';
import { renderWelcomeEmail } from './templates/welcome-email';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async sendWelcomeEmail(to: string, displayName: string): Promise<void> {
    const { subject, html, text } = renderWelcomeEmail(displayName);
    await this.emailProvider.send({ to, subject, html, text });
  }
}
