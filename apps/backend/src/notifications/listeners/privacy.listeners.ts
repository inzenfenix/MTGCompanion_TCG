import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DATA_RIGHTS_CLOSED_EVENT,
  DataRightsClosedEvent,
} from '../../common/events/data-rights-closed.event';
import {
  RIGHTS_CONFIRMATION_EVENT,
  RightsConfirmationEvent,
} from '../../common/events/rights-confirmation.event';
import {
  EMAIL_CHANGED_EVENT,
  EmailChangedEvent,
} from '../../common/events/email-changed.event';
import {
  OFFER_RECEIVED_EVENT,
  OfferReceivedEvent,
} from '../../common/events/offer-received.event';
import { maskEmail } from '../../common/privacy/redact';
import { ConsentService } from '../../consent/application/consent.service';
import { ProcessingControlService } from '../../processing-control/application/processing-control.service';
import { UsersService } from '../../users/application/users.service';
import { NotificationsService } from '../notifications.service';

/**
 * ROADMAP.md O15 — same shape as UserCreatedListener: the module that does
 * the work just emits, and a failed email never fails the request.
 */
@Injectable()
export class PrivacyListeners {
  private readonly logger = new Logger(PrivacyListeners.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly consent: ConsentService,
    private readonly users: UsersService,
    private readonly processingControl: ProcessingControlService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @OnEvent(DATA_RIGHTS_CLOSED_EVENT)
  async onRightsClosed(e: DataRightsClosedEvent): Promise<void> {
    await this.safely(e.email, 'rights response', () =>
      this.notifications.sendRightsResponseEmail(e.email, {
        displayName: e.displayName,
        requestId: e.requestId,
        type: e.type,
        outcome: e.outcome,
        message: e.message,
        effect: e.effect,
        awaitingStepUp: e.awaitingStepUp,
      }),
    );
  }

  @OnEvent(RIGHTS_CONFIRMATION_EVENT)
  async onRightsConfirmation(e: RightsConfirmationEvent): Promise<void> {
    const base = this.config.get('privacy', { infer: true }).publicAppUrl;
    await this.safely(e.email, 'rights confirmation code', () =>
      this.notifications.sendRightsConfirmationEmail(e.email, {
        displayName: e.displayName,
        requestId: e.requestId,
        type: e.type,
        code: e.code,
        expiresAt: e.expiresAt,
        confirmUrl: base
          ? `${base.replace(/\/$/, '')}/derechos/confirmar?code=${encodeURIComponent(e.code)}`
          : undefined,
      }),
    );
  }

  @OnEvent(EMAIL_CHANGED_EVENT)
  async onEmailChanged(e: EmailChangedEvent): Promise<void> {
    await this.safely(e.previousEmail, 'email-changed notice', () =>
      this.notifications.sendEmailChangedEmail(e.previousEmail, e.displayName),
    );
  }

  /**
   * The consent check happens here, at send time — not when the offer was
   * placed and not from a cached flag — so a revocation takes effect from
   * the very next offer.
   */
  @OnEvent(OFFER_RECEIVED_EVENT)
  async onOfferReceived(e: OfferReceivedEvent): Promise<void> {
    if (!(await this.consent.hasConsent(e.sellerId, 'EMAIL_NOTIFICATIONS'))) {
      return;
    }
    // O16: an active blocking stops optional emails even with consent.
    if (await this.processingControl.isBlocked(e.sellerId)) return;
    const seller = await this.users.findById(e.sellerId);
    if (!seller) return;
    await this.safely(seller.email, 'offer-received email', () =>
      this.notifications.sendOfferReceivedEmail(seller.email, {
        displayName: seller.displayName,
        cardTitle: e.cardTitle,
        amount: e.amount,
      }),
    );
  }

  private async safely(to: string, what: string, send: () => Promise<void>) {
    try {
      await send();
    } catch (err) {
      this.logger.error(
        `Failed to send ${what} to ${maskEmail(to)}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
