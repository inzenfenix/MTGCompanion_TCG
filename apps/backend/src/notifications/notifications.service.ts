import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_PROVIDER, type EmailProvider } from './email-provider.interface';
import { renderWelcomeEmail } from './templates/welcome-email';
import { renderPaymentReceiptEmail } from './templates/payment-receipt';
import {
  renderEmailChangedEmail,
  renderOfferReceivedEmail,
  renderRightsResponseEmail,
  renderSecurityAlertEmail,
} from './templates/privacy-emails';

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

  // ── ROADMAP.md O15 ──────────────────────────────────────────────────────

  /** Written answer to a rights request (Ley 19.628, art. 11). */
  async sendRightsResponseEmail(
    to: string,
    params: Parameters<typeof renderRightsResponseEmail>[0],
  ): Promise<void> {
    await this.emailProvider.send({ to, ...renderRightsResponseEmail(params) });
  }

  /** Sent to the *previous* address after a rectification changed it. */
  async sendEmailChangedEmail(to: string, displayName: string): Promise<void> {
    await this.emailProvider.send({
      to,
      ...renderEmailChangedEmail(displayName),
    });
  }

  async sendSecurityAlertEmail(
    to: string,
    params: Parameters<typeof renderSecurityAlertEmail>[0],
  ): Promise<void> {
    await this.emailProvider.send({ to, ...renderSecurityAlertEmail(params) });
  }

  /** Optional email — callers must check the EMAIL_NOTIFICATIONS consent first. */
  async sendOfferReceivedEmail(
    to: string,
    params: Parameters<typeof renderOfferReceivedEmail>[0],
  ): Promise<void> {
    await this.emailProvider.send({ to, ...renderOfferReceivedEmail(params) });
  }
}
