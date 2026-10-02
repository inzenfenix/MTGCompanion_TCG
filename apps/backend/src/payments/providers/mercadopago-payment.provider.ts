import {
  Injectable,
  Logger,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import MercadoPagoConfig, {
  Payment as MpPayment,
  Preference,
  WebhookSignatureValidator,
} from 'mercadopago';
import type { AppConfig } from '../../config/configuration';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  WebhookContext,
} from '../payment-provider.interface';

/**
 * Real MercadoPago Checkout Pro integration. Only actually reachable when
 * PAYMENT_PROVIDERS' factory (payments.module.ts) selects this provider,
 * which it only does when MERCADOPAGO_ACCESS_TOKEN is set — otherwise the
 * registry falls back to NoopPaymentProvider, same as today. The SDK client
 * is built lazily per call from ConfigService rather than in the
 * constructor, so instantiating this class (Nest instantiates every
 * registered provider regardless of which one is selected) never touches
 * the MercadoPago SDK with an empty token.
 */
@Injectable()
export class MercadoPagoProvider implements PaymentProvider {
  private readonly logger = new Logger(MercadoPagoProvider.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  private client(): MercadoPagoConfig {
    const accessToken = this.config.get('payments', { infer: true }).mercadopago
      .accessToken;
    if (!accessToken) {
      // Shouldn't happen in practice — the registry only picks this provider
      // when a token is configured — but fail loudly rather than silently
      // calling MercadoPago's API with an empty token.
      throw new NotImplementedException(
        'MERCADOPAGO_ACCESS_TOKEN is not configured',
      );
    }
    return new MercadoPagoConfig({ accessToken });
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const { notificationUrl } = this.config.get('payments', {
      infer: true,
    }).mercadopago;
    const preference = await new Preference(this.client()).create({
      body: {
        // external_reference is our own Transaction.id — this is the join
        // key handleWebhook() uses to report back which transaction got
        // paid, since MercadoPago's payment id (from the webhook) is a
        // different id than this preference's id.
        external_reference: input.transactionId,
        items: [
          {
            id: input.transactionId,
            title: input.description,
            quantity: 1,
            currency_id: 'CLP',
            unit_price: input.amount,
          },
        ],
        notification_url: notificationUrl
          ? `${notificationUrl}/payments/webhook`
          : undefined,
      },
    });

    if (!preference.id || !preference.init_point) {
      throw new Error('MercadoPago did not return a preference id/init_point');
    }

    return { paymentRef: preference.id, redirectUrl: preference.init_point };
  }

  async handleWebhook(
    payload: unknown,
    context: WebhookContext,
  ): Promise<{ transactionId: string; paid: boolean }> {
    const { webhookSecret } = this.config.get('payments', {
      infer: true,
    }).mercadopago;
    if (!webhookSecret) {
      throw new NotImplementedException(
        'MERCADOPAGO_WEBHOOK_SECRET is not configured',
      );
    }

    const dataId =
      pickHeaderOrQuery(context.query['data.id']) ?? extractDataId(payload);
    try {
      WebhookSignatureValidator.validate({
        xSignature: context.headers['x-signature'],
        xRequestId: context.headers['x-request-id'],
        dataId,
        secret: webhookSecret,
        toleranceSeconds: 300,
      });
    } catch (err) {
      this.logger.warn(
        `Rejected MercadoPago webhook — invalid signature: ${(err as Error).message}`,
      );
      throw new UnauthorizedException('Invalid MercadoPago webhook signature');
    }

    if (!dataId) {
      throw new UnauthorizedException('MercadoPago webhook missing data.id');
    }

    // Don't trust the webhook body's own status — re-fetch the payment from
    // MercadoPago's API directly, per MercadoPago's own guidance.
    const payment = await new MpPayment(this.client()).get({ id: dataId });
    if (!payment.external_reference) {
      throw new Error(
        `MercadoPago payment ${dataId} has no external_reference`,
      );
    }

    return {
      transactionId: payment.external_reference,
      paid: payment.status === 'approved',
    };
  }
}

function pickHeaderOrQuery(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Fallback for older-style notifications that carry `data.id` in the body instead of the query string. */
function extractDataId(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    const data = (payload as { data?: { id?: string | number } }).data;
    return data?.id !== undefined ? String(data.id) : undefined;
  }
  return undefined;
}
