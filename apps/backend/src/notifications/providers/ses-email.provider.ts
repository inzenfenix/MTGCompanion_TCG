import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';
import type { AppConfig } from '../../config/configuration';
import type {
  EmailProvider,
  SendEmailInput,
} from '../email-provider.interface';

/**
 * Prod provider — AWS SES. Not SNS: SNS is pub/sub messaging (topics,
 * push/SMS) and would require each recipient to confirm a subscription
 * before receiving anything, which doesn't fit "email a new user on signup".
 * SES is AWS's actual transactional-email product. SNS stays a good fit
 * later for push-style notifications (e.g. price alerts), just not this.
 *
 * Untested against AWS Academy: Academy/Vocareum lab accounts hand out
 * short-lived IAM credentials with a locked-down permission set and no
 * SES production access (new SES accounts also start in a sandbox that
 * only sends to verified addresses) — so this class may simply not work
 * there. It costs nothing to leave wired in (EMAIL_PROVIDER=smtp is the
 * default, see .env.example), and it's a real seam for a course grader or
 * a later non-Academy deployment. For the presentation, just use MailHog.
 */
@Injectable()
export class SesEmailProvider implements EmailProvider {
  private readonly logger = new Logger(SesEmailProvider.name);
  private readonly client: SESClient;
  private readonly from: string;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const email = this.config.get('email', { infer: true });
    this.from = email.from;
    this.client = new SESClient({ region: email.ses.region });
  }

  async send(input: SendEmailInput): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        Source: this.from,
        Destination: { ToAddresses: [input.to] },
        Message: {
          Subject: { Data: input.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: input.html, Charset: 'UTF-8' },
            Text: { Data: input.text, Charset: 'UTF-8' },
          },
        },
      }),
    );
    this.logger.log(`(ses) sent "${input.subject}" to ${input.to}`);
  }
}
