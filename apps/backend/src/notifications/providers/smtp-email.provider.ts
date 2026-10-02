import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { AppConfig } from '../../config/configuration';
import type {
  EmailProvider,
  SendEmailInput,
} from '../email-provider.interface';

/**
 * Local dev provider — sends through MailHog (docker/dev.sh up), an SMTP
 * sink with no real delivery and a web UI at http://localhost:8025 to read
 * what was "sent". No AWS credentials needed.
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  private readonly logger = new Logger(SmtpEmailProvider.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const email = this.config.get('email', { infer: true });
    this.from = email.from;
    this.transporter = createTransport({
      host: email.smtp.host,
      port: email.smtp.port,
      secure: false,
    });
  }

  async send(input: SendEmailInput): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...input });
    this.logger.log(
      `(mailhog) sent "${input.subject}" to ${input.to} — view at http://localhost:8025`,
    );
  }
}
