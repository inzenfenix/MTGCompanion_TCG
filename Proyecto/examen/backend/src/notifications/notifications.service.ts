import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_PROVIDER, type EmailProvider } from './email-provider.interface';
import { renderWelcomeEmail } from './templates/welcome-email';
import { renderPaymentReceiptEmail } from './templates/payment-receipt';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async sendWelcomeEmail(to: string, displayName: string): Promise<void> {
    const { subject, html, text } = renderWelcomeEmail(displayName);
    await this.emailProvider.send({ to, subject, html, text });
  }

  /** ROADMAP.md J8 — sent to both buyer and seller once a transaction reaches PAID. */
  async sendPaymentReceiptEmail(
    to: string,
    params: {
      cardTitle: string;
      paymentMethod: string;
      net: number;
      iva: number;
      total: number;
    },
  ): Promise<void> {
    const { subject, html, text } = renderPaymentReceiptEmail(params);
    await this.emailProvider.send({ to, subject, html, text });
  }
}
