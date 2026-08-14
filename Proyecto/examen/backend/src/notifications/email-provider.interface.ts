export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<void>;
}

/** DI token — bound to SmtpEmailProvider or SesEmailProvider depending on EMAIL_PROVIDER. */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
